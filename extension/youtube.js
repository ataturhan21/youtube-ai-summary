// Adds a "Summarize" button to YouTube watch pages. It reads the transcript from YouTube's own
// transcript panel (YouTube's caption APIs now reject outside requests), builds the prompt and
// asks the background worker to open the chosen AI chat with it.
(() => {
  if (window.__ytsLoaded) return;
  window.__ytsLoaded = true;

  const { AIS, PROMPTS, DEFAULTS, parseTime, parseSegmentText, formatTranscript, buildPrompt } = self.YTS;
  const SEGMENTS = "ytd-transcript-segment-renderer, transcript-segment-view-model";
  const CHAPTERS = "ytd-transcript-section-header-renderer, transcript-section-header-view-model";
  const TRANSCRIPT_BUTTON = "ytd-video-description-transcript-section-renderer button";

  let settings = { ...DEFAULTS };
  let busy = false;
  let ui = null;
  const cache = new Map();

  chrome.storage.sync.get(DEFAULTS, (stored) => { settings = stored; render(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key of Object.keys(changes)) settings[key] = changes[key].newValue;
    render();
  });
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === "yts:run") {
      if (isWatch()) run({});
      reply({ ok: isWatch() });
    }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const videoId = () => new URL(location.href).searchParams.get("v");
  const isWatch = () => location.pathname === "/watch" && Boolean(videoId());
  const aiName = (id) => (AIS.find((a) => a.id === id) || AIS[0]).name;

  async function waitFor(check, timeout, step = 200) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = check();
      if (value) return value;
      await sleep(step);
    }
    return null;
  }

  // ---------- transcript ----------

  // YouTube hides a closed transcript panel without emptying it, so lines count only while their
  // panel is open; otherwise a previous video's transcript could be read.
  const inOpenPanel = (node) => {
    const panel = node.closest("ytd-engagement-panel-section-list-renderer");
    return !node.closest("[hidden]") && (!panel || panel.getAttribute("visibility") !== "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
  };
  const visibleSegments = () => [...document.querySelectorAll(SEGMENTS)].filter(inOpenPanel);

  // Two layouts exist. The classic one keeps every line in a ytd-transcript-segment-list-renderer,
  // and the page also holds a hidden list from the previous video plus duplicates of the current
  // one, so read only the first visible list. The newer one wraps each line on its own, so climb
  // from the first line to the ancestor that holds the most lines.
  function transcriptRoot() {
    const lists = [...document.querySelectorAll("ytd-transcript-segment-list-renderer")]
      .filter((list) => inOpenPanel(list) && list.querySelector(SEGMENTS));
    if (lists.length) return lists[0];
    const first = visibleSegments()[0];
    if (!first) return null;
    const panel = first.closest("ytd-engagement-panel-section-list-renderer");
    let best = first;
    let bestCount = 1;
    for (let node = first.parentElement; node && node !== panel; node = node.parentElement) {
      const count = node.querySelectorAll(SEGMENTS).length;
      if (count > bestCount) {
        best = node;
        bestCount = count;
      }
    }
    return best;
  }

  function transcriptPanel() {
    return transcriptRoot()?.closest("ytd-engagement-panel-section-list-renderer") || null;
  }

  function firstSegmentText() {
    return transcriptRoot()?.querySelector(SEGMENTS)?.textContent || "";
  }

  function readSegment(node) {
    const timeEl = node.querySelector('.segment-timestamp, [class*="SegmentViewModelTimestamp"]:not([class*="A11y"])');
    const textEl = node.querySelector('.segment-text, [role="text"]');
    const time = timeEl?.textContent.trim() || "";
    const text = textEl?.textContent || "";
    if (/^\d+(?::\d{2}){1,2}$/.test(time) && text.trim()) return { time, text };
    return parseSegmentText(node.innerText); // unknown markup: work from the visible text
  }

  function readTranscript() {
    const root = transcriptRoot();
    if (!root) return [];
    const items = [];
    const seen = new Set();
    for (const node of root.querySelectorAll(`${CHAPTERS}, ${SEGMENTS}`)) {
      if (node.closest("[hidden]")) continue;
      if (node.matches(CHAPTERS)) {
        const title = node.textContent.replace(/\s+/g, " ").trim();
        if (title) items.push({ type: "chapter", title });
        continue;
      }
      const { time, text } = readSegment(node);
      const key = `${time}|${text.trim()}`;
      if (!text.trim() || seen.has(key)) continue;
      seen.add(key);
      items.push({ type: "line", start: parseTime(time), text });
    }
    return items;
  }

  async function openTranscriptPanel() {
    let button = document.querySelector(TRANSCRIPT_BUTTON);
    if (!button) {
      document.querySelector("ytd-watch-metadata #description-inline-expander #expand")?.click();
      button = await waitFor(() => document.querySelector(TRANSCRIPT_BUTTON), 3000);
    }
    if (!button) return false;
    const stale = document.querySelector(SEGMENTS)?.textContent || "";
    button.click();
    if (!(await waitFor(firstSegmentText, 10000))) return false;
    // A panel left over from the previous video can still hold its lines for a moment.
    if (stale) await waitFor(() => firstSegmentText() !== stale, 2500);
    await sleep(300);
    return true;
  }

  function closeTranscriptPanel(panel) {
    panel?.querySelector('#visibility-button button, button[aria-label="Close transcript"]')?.click();
  }

  async function getTranscript(id) {
    if (cache.has(id)) return cache.get(id);
    const alreadyOpen = Boolean(transcriptRoot());
    if (!alreadyOpen && !(await openTranscriptPanel())) return null;
    const panel = transcriptPanel();
    const items = readTranscript();
    if (!alreadyOpen) closeTranscriptPanel(panel);
    if (items.length && videoId() === id) cache.set(id, items);
    return items.length ? items : null;
  }

  if (window.__YTS_TEST__) window.__ytsTest = { readTranscript, getTranscript };

  function videoInfo() {
    const id = videoId();
    return {
      id,
      title: document.querySelector("ytd-watch-metadata h1")?.innerText.trim() || document.title.replace(/ - YouTube$/, ""),
      channel: document.querySelector("ytd-watch-metadata ytd-channel-name a")?.innerText.trim() || "",
      // While an ad plays, the player's clock shows the ad's length, so leave it out.
      duration: document.getElementById("movie_player")?.classList.contains("ad-showing")
        ? ""
        : document.querySelector(".ytp-time-duration")?.textContent.trim() || "",
      url: `https://www.youtube.com/watch?v=${id}`
    };
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function run({ promptId, question, copyOnly }) {
    if (busy || !isWatch()) return;
    busy = true;
    render("Reading transcript…");
    try {
      // Right after moving to another video, YouTube still shows the previous one for a moment.
      const id = videoId();
      const ready = await waitFor(() => {
        const page = document.querySelector("ytd-watch-flexy");
        return !page || page.getAttribute("video-id") === id;
      }, 8000);
      if (!ready) {
        toast("YouTube is still loading this video. Try again in a moment.");
        return;
      }
      const video = videoInfo();
      const items = await getTranscript(video.id);
      const transcript = items ? formatTranscript(items, { timestamps: settings.timestamps }) : "";

      if (copyOnly) {
        if (!transcript) toast("This video has no transcript to copy.");
        else toast((await copy(transcript)) ? "Transcript copied." : "Couldn't reach the clipboard. Click the page and try again.");
        return;
      }

      const text = buildPrompt({ video, transcript, settings, promptId, question });
      const copied = await copy(text);
      const res = await chrome.runtime.sendMessage({ type: "yts:open", ai: settings.ai, text, autoSend: settings.autoSend });
      if (!res || !res.ok) throw new Error("the extension couldn't open a new tab");
      const name = aiName(settings.ai);
      toast(transcript
        ? `Opened ${name}.${copied ? " The prompt is also on your clipboard." : ""}`
        : `No transcript for this video, so ${name} got the link instead.`);
    } catch (err) {
      toast(`Couldn't summarize: ${err.message}. Reload the page and try again.`);
    } finally {
      busy = false;
      render();
    }
  }

  // ---------- UI ----------

  // Explicit colours: YouTube's CSS variables aren't defined everywhere in its newer layout.
  const STYLE = `
    .yts-wrap { --yts-bg: rgba(0,0,0,.05); --yts-bg-hover: rgba(0,0,0,.1); --yts-fg: #0f0f0f; --yts-muted: #606060;
      --yts-line: rgba(0,0,0,.1); --yts-menu: #fff;
      position: relative; display: inline-flex; align-items: center; margin: 0 8px; flex: none; }
    html[dark] .yts-wrap { --yts-bg: rgba(255,255,255,.1); --yts-bg-hover: rgba(255,255,255,.2); --yts-fg: #f1f1f1;
      --yts-muted: #aaa; --yts-line: rgba(255,255,255,.2); --yts-menu: #282828; }
    .yts-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border: 0;
      font: 500 14px/36px Roboto, Arial, sans-serif; cursor: pointer; white-space: nowrap;
      background: var(--yts-bg); color: var(--yts-fg); }
    .yts-btn:hover { background: var(--yts-bg-hover); }
    .yts-btn:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
    .yts-main { border-radius: 18px 0 0 18px; }
    .yts-more { border-radius: 0 18px 18px 0; padding: 0 10px; border-left: 1px solid var(--yts-line); }
    .yts-btn[disabled] { opacity: .6; cursor: progress; }
    .yts-menu { position: absolute; top: 42px; left: 0; z-index: 2300; min-width: 250px; padding: 8px 0; border-radius: 12px;
      background: var(--yts-menu); color: var(--yts-fg); box-shadow: 0 4px 32px rgba(0,0,0,.3);
      font: 14px Roboto, Arial, sans-serif; }
    .yts-menu[hidden] { display: none; }
    .yts-head { padding: 8px 16px 4px; font-size: 12px; color: var(--yts-muted); }
    .yts-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 16px; border: 0; background: none;
      color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .yts-item:hover, .yts-item:focus-visible { background: var(--yts-bg-hover); outline: none; }
    .yts-check { width: 16px; flex: none; }
    .yts-ask { display: flex; gap: 6px; padding: 4px 16px 8px; }
    .yts-ask input { flex: 1; min-width: 0; padding: 6px 8px; border-radius: 8px; font: inherit; color: inherit;
      border: 1px solid var(--yts-line); background: transparent; }
    .yts-sep { height: 1px; margin: 6px 0; background: var(--yts-line); }
    .yts-toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 9999; max-width: 90vw;
      padding: 12px 18px; border-radius: 10px; background: #0f0f0f; color: #fff; font: 14px Roboto, Arial, sans-serif;
      box-shadow: 0 4px 24px rgba(0,0,0,.3); }
  `;

  function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of [].concat(children)) node.append(child);
    return node;
  }

  function ensureStyle() {
    if (!document.getElementById("yts-style")) {
      document.head.append(el("style", { id: "yts-style", textContent: STYLE }));
    }
  }

  function buildUI() {
    ensureStyle();
    const main = el("button", { className: "yts-btn yts-main", type: "button" });
    const more = el("button", { className: "yts-btn yts-more", type: "button", textContent: "▾", ariaLabel: "More summary options" });
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    const menu = el("div", { className: "yts-menu", hidden: true });
    menu.setAttribute("role", "menu");
    const wrap = el("div", { className: "yts-wrap" }, [main, more, menu]);

    main.addEventListener("click", () => run({}));
    more.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) toggleMenu(false); });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { toggleMenu(false); more.focus(); } });
    return { wrap, main, more, menu };
  }

  function toggleMenu(force) {
    if (!ui) return;
    const open = force === undefined ? ui.menu.hidden : force;
    if (open) fillMenu();
    ui.menu.hidden = !open;
    ui.more.setAttribute("aria-expanded", String(open));
    if (open) ui.menu.querySelector(".yts-item")?.focus();
  }

  function fillMenu() {
    const item = (label, checked, onClick) => {
      const b = el("button", { className: "yts-item", type: "button" },
        [el("span", { className: "yts-check", textContent: checked ? "✓" : "" }), label]);
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", onClick);
      return b;
    };
    const runWith = (opts) => () => { toggleMenu(false); run(opts); };

    const ask = el("input", { type: "text", placeholder: "Ask about this video…", ariaLabel: "Question about this video" });
    ask.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && ask.value.trim()) { e.preventDefault(); runWith({ promptId: "ask", question: ask.value })(); }
      e.stopPropagation(); // keep YouTube's shortcuts (k, j, l, f…) out of the text box
    });
    const askGo = el("button", { className: "yts-btn", type: "button", textContent: "Ask" });
    askGo.style.borderRadius = "8px";
    askGo.style.height = "32px";
    askGo.addEventListener("click", () => ask.value.trim() && runWith({ promptId: "ask", question: ask.value })());

    const prompts = ["summary", "keypoints", "notes"].map((id) => item(PROMPTS[id].name, false, runWith({ promptId: id })));
    if ((settings.customPrompt || "").trim()) prompts.push(item(PROMPTS.custom.name, false, runWith({ promptId: "custom" })));

    ui.menu.replaceChildren(
      el("div", { className: "yts-head", textContent: "Send to" }),
      ...AIS.map((a) => item(a.name, a.id === settings.ai, () => {
        settings.ai = a.id;
        chrome.storage.sync.set({ ai: a.id });
        fillMenu();
      })),
      el("div", { className: "yts-sep" }),
      el("div", { className: "yts-head", textContent: `Prompt (sends to ${aiName(settings.ai)})` }),
      ...prompts,
      el("div", { className: "yts-ask" }, [ask, askGo]),
      el("div", { className: "yts-sep" }),
      item("Copy transcript", false, runWith({ copyOnly: true }))
    );
  }

  function render(status) {
    if (!ui) return;
    ui.main.disabled = busy;
    ui.main.textContent = status || `✦ Summarize · ${aiName(settings.ai)}`;
    ui.main.title = `Send this video's transcript to ${aiName(settings.ai)} (Alt+Shift+S)`;
  }

  function ensureButton() {
    if (!isWatch()) {
      ui?.wrap.remove();
      return;
    }
    if (ui && document.contains(ui.wrap)) return;
    const actions = document.querySelector("ytd-watch-metadata #top-row #actions");
    if (!actions) return;
    ui = ui || buildUI();
    actions.parentElement.insertBefore(ui.wrap, actions);
    render();
  }

  let toastTimer;
  function toast(message) {
    ensureStyle();
    document.querySelector(".yts-toast")?.remove();
    const t = el("div", { className: "yts-toast", textContent: message });
    t.setAttribute("role", "status");
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 5000);
  }

  document.addEventListener("yt-navigate-finish", ensureButton);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; ensureButton(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  ensureButton();
})();
