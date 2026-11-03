const test = require("node:test");
const assert = require("node:assert/strict");
const { formatTime, parseTime, formatTranscript, buildPrompt, aiForHost, DEFAULTS, AIS } = require("../extension/shared.js");

test("formatTime and parseTime round-trip", () => {
  assert.equal(formatTime(4), "0:04");
  assert.equal(formatTime(754), "12:34");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(parseTime("1:02:05"), 3725);
  assert.equal(parseTime(" 0:04 "), 4);
  assert.equal(parseTime("abc"), 0);
});

test("formatTranscript merges lines into ~30s paragraphs with one timestamp each", () => {
  const items = [
    { type: "line", start: 0, text: "Hello\nthere." },
    { type: "line", start: 10, text: "Second line." },
    { type: "line", start: 31, text: "Third line." },
    { type: "line", start: 40, text: "Fourth." }
  ];
  assert.equal(formatTranscript(items), "[0:00] Hello there. Second line. Third line.\n[0:40] Fourth.");
  assert.equal(formatTranscript(items, { timestamps: false }), "Hello there. Second line. Third line.\nFourth.");
});

test("formatTranscript keeps chapters as headings and skips empty lines", () => {
  const items = [
    { type: "chapter", title: "Intro" },
    { type: "line", start: 0, text: "Hi." },
    { type: "line", start: 5, text: "   " },
    { type: "chapter", title: "Main part" },
    { type: "line", start: 60, text: "Body." }
  ];
  assert.equal(formatTranscript(items), "## Intro\n[0:00] Hi.\n\n## Main part\n[1:00] Body.");
});

const video = { title: "T", channel: "C", duration: "10:00", url: "https://www.youtube.com/watch?v=x" };

test("buildPrompt includes instructions, video details and the transcript", () => {
  const p = buildPrompt({ video, transcript: "[0:00] hi", settings: DEFAULTS });
  assert.match(p, /^Summarize this YouTube video\./);
  assert.match(p, /Title: T\nChannel: C\nLength: 10:00\nURL: https:\/\/www\.youtube\.com\/watch\?v=x/);
  assert.match(p, /Transcript:\n"""\n\[0:00\] hi\n"""$/);
});

test("buildPrompt fills the question, language and custom prompt", () => {
  const settings = { ...DEFAULTS, language: "Türkçe", customPrompt: "Mine." };
  assert.match(buildPrompt({ video, transcript: "x", settings, promptId: "ask", question: " Why? " }), /cite \[m:ss\] timestamps: Why\?\n\nRespond in Türkçe\./);
  assert.match(buildPrompt({ video, transcript: "x", settings, promptId: "custom" }), /^Mine\.\n\nRespond in Türkçe\./);
});

test("buildPrompt without a transcript falls back to the link", () => {
  assert.match(buildPrompt({ video, transcript: "", settings: DEFAULTS }), /This video has no transcript\./);
});

test("aiForHost finds each site and every AI has an editor selector", () => {
  assert.equal(aiForHost("claude.ai").id, "claude");
  assert.equal(aiForHost("chat.openai.com").id, "chatgpt");
  assert.equal(aiForHost("example.com"), null);
  for (const ai of AIS) assert.ok(ai.editor.length && ai.url.startsWith("https://"));
});
