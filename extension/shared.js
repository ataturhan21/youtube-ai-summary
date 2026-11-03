// AI targets, prompt templates, settings and the pure helpers that build the prompt.
// Loaded by every part of the extension and by the Node unit tests.
(function (root) {
  const AIS = [
    { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", hosts: ["chatgpt.com", "chat.openai.com"],
      editor: ["#prompt-textarea", 'textarea[name="prompt"]', 'div.ProseMirror[contenteditable="true"]'],
      send: ['button[data-testid="send-button"]', "#composer-submit-button"] },
    { id: "claude", name: "Claude", url: "https://claude.ai/new", hosts: ["claude.ai"],
      editor: ['div.ProseMirror[contenteditable="true"]'],
      send: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]'] },
    { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", hosts: ["gemini.google.com"],
      editor: ["rich-textarea .ql-editor", 'div.ql-editor[contenteditable="true"]'],
      send: ["button.send-button", 'button[aria-label="Send message"]'] },
    { id: "grok", name: "Grok", url: "https://grok.com/", hosts: ["grok.com"],
      editor: ["textarea", 'div[contenteditable="true"]'],
      send: ['button[type="submit"]', 'button[aria-label="Submit"]'] },
    { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/", hosts: ["chat.deepseek.com"],
      editor: ["textarea"],
      send: [] },
    { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/", hosts: ["www.perplexity.ai"],
      editor: ["#ask-input", "textarea", 'div[contenteditable="true"]'],
      send: ['button[aria-label="Submit"]', 'button[data-testid="submit-button"]'] }
  ];

  const PROMPTS = {
    summary: {
      name: "Summary",
      text: "Summarize this YouTube video.\n\n" +
        "1. TL;DR: two or three sentences.\n" +
        "2. Key points: bullets, each starting with its [m:ss] timestamp.\n" +
        "3. Takeaways: anything the viewer can act on.\n\n" +
        "Base everything on the transcript below."
    },
    keypoints: {
      name: "Key points",
      text: "List the 5–10 most important ideas in this YouTube video as bullets. " +
        "Start each with its [m:ss] timestamp and explain it in one sentence."
    },
    notes: {
      name: "Study notes",
      text: "Turn this YouTube video into study notes: headings that follow the video, " +
        "definitions of key terms, and a 5-question quiz with answers at the end."
    },
    ask: {
      name: "Ask a question",
      text: "Answer this question using only the transcript of the YouTube video below, " +
        "and cite [m:ss] timestamps: {{question}}"
    },
    custom: { name: "My prompt", text: "" }
  };

  const DEFAULTS = {
    ai: "chatgpt",
    prompt: "summary",
    timestamps: true,
    autoSend: true,
    language: "",
    customPrompt: "Summarize this video in 5 bullet points."
  };

  function formatTime(seconds) {
    const t = Math.max(0, Math.floor(seconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = String(t % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  function parseTime(text) {
    const parts = String(text).trim().split(":").map(Number);
    if (!parts.length || parts.some((n) => Number.isNaN(n))) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0);
  }

  // items: [{ type: "chapter", title } | { type: "line", start: seconds, text }]
  // Lines are merged into paragraphs of about `chunkSeconds`, each with one timestamp,
  // which keeps the prompt short without losing where things were said.
  function formatTranscript(items, { timestamps = true, chunkSeconds = 30 } = {}) {
    const out = [];
    let buf = [];
    let bufStart = null;
    const flush = () => {
      if (!buf.length) return;
      out.push((timestamps ? `[${formatTime(bufStart)}] ` : "") + buf.join(" "));
      buf = [];
      bufStart = null;
    };
    for (const item of items) {
      if (item.type === "chapter") {
        flush();
        out.push("", `## ${item.title}`);
        continue;
      }
      const text = String(item.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (bufStart === null) bufStart = item.start;
      buf.push(text);
      if (item.start - bufStart >= chunkSeconds) flush();
    }
    flush();
    return out.join("\n").trim();
  }

  function buildPrompt({ video, transcript, settings, promptId, question }) {
    const id = promptId || settings.prompt;
    let instructions = id === "custom" ? settings.customPrompt || "" : (PROMPTS[id] || PROMPTS.summary).text;
    instructions = instructions.replace("{{question}}", (question || "").trim());
    if (settings.language && settings.language.trim()) {
      instructions += `\n\nRespond in ${settings.language.trim()}.`;
    }
    const header = [
      `Title: ${video.title}`,
      video.channel && `Channel: ${video.channel}`,
      video.duration && `Length: ${video.duration}`,
      `URL: ${video.url}`
    ].filter(Boolean).join("\n");
    const body = transcript
      ? `Transcript:\n"""\n${transcript}\n"""`
      : "This video has no transcript. If you can open the URL above, use it; otherwise say that you can't see the video.";
    return `${instructions.trim()}\n\n${header}\n\n${body}`;
  }

  function aiForHost(host) {
    return AIS.find((a) => a.hosts.includes(host)) || null;
  }

  const api = { AIS, PROMPTS, DEFAULTS, formatTime, parseTime, formatTranscript, buildPrompt, aiForHost };
  root.YTS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
