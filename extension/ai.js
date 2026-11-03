// Runs on the AI chat sites. If this tab was opened by the Summarize button, it picks up the
// prompt from the background worker, pastes it into the chat box and (optionally) sends it.
(() => {
  if (window.__ytsAiLoaded) return;
  window.__ytsAiLoaded = true;

  const ai = self.YTS.aiForHost(location.hostname);
  if (!ai) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (node) => node && node.getClientRects().length > 0;

  async function waitFor(check, timeout, step = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = check();
      if (value) return value;
      await sleep(step);
    }
    return null;
  }

  const area = (node) => {
    const r = node.getBoundingClientRect();
    return r.width * r.height;
  };
  const enabled = (b) => !b.disabled && b.getAttribute("aria-disabled") !== "true";

  // Known selectors first; chat sites redesign often, so fall back to the largest visible text box.
  function findEditor() {
    for (const sel of ai.editor) {
      const node = [...document.querySelectorAll(sel)].find(visible);
      if (node) return node;
    }
    const boxes = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
      .filter((n) => visible(n) && !n.readOnly && !n.disabled);
    return boxes.sort((a, b) => area(b) - area(a))[0] || null;
  }

  // Known selectors first, then the nearest button around the editor that looks like "send".
  function findSendButton(editor) {
    for (const sel of ai.send) {
      const b = [...document.querySelectorAll(sel)].find(visible);
      if (b) return b;
    }
    let node = editor.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const b = [...node.querySelectorAll("button")].find((btn) => visible(btn) && (
        btn.type === "submit" ||
        /send|submit/i.test(`${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("data-testid") || ""}`)));
      if (b) return b;
    }
    return null;
  }

  function insert(editor, text) {
    editor.focus();
    if (editor.tagName === "TEXTAREA") {
      editor.select();
      if (!document.execCommand("insertText", false, text)) {
        const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setValue.call(editor, text);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    // Rich editors (ProseMirror, Quill, Lexical) handle a paste of the whole prompt in one step,
    // which is far faster than typing it and lets ChatGPT turn very long text into an attachment.
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    editor.dispatchEvent(paste);
    if (!paste.defaultPrevented) document.execCommand("insertText", false, text);
  }

  async function send(editor) {
    await sleep(500);
    // A send button that exists but is disabled usually means a long paste is still uploading
    // as a file, so wait for it. With no send button at all, the site sends on Enter.
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const button = findSendButton(editor);
      if (button && enabled(button)) {
        button.click();
        return;
      }
      if (!button && Date.now() - start > 2000) break;
      await sleep(250);
    }
    editor.focus();
    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
  }

  function toast(message) {
    const t = document.createElement("div");
    t.textContent = message;
    t.setAttribute("role", "status");
    Object.assign(t.style, {
      position: "fixed", left: "50%", bottom: "32px", transform: "translateX(-50%)", zIndex: 2147483647,
      maxWidth: "90vw", padding: "12px 18px", borderRadius: "10px", background: "#111", color: "#fff",
      font: "14px system-ui, sans-serif", boxShadow: "0 4px 24px rgba(0,0,0,.3)"
    });
    document.body.append(t);
    setTimeout(() => t.remove(), 7000);
  }

  async function takeJob() {
    // The tab can load before the background worker has stored the job, so ask a few times.
    for (let i = 0; i < 10; i++) {
      try {
        const job = await chrome.runtime.sendMessage({ type: "yts:take" });
        if (job) return job;
      } catch {
        return null;
      }
      await sleep(400);
    }
    return null;
  }

  (async () => {
    const job = await takeJob();
    if (!job) return;
    const editor = await waitFor(findEditor, 20000);
    if (!editor) {
      toast(`Couldn't find the ${ai.name} chat box. The prompt is on your clipboard: click the box and press Ctrl+V.`);
      return;
    }
    insert(editor, job.text);
    if (job.autoSend) await send(editor);
  })();
})();
