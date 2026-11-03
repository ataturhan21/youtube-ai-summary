const { AIS, PROMPTS, DEFAULTS } = self.YTS;
const $ = (id) => document.getElementById(id);

for (const a of AIS) $("ai").append(new Option(a.name, a.id));
for (const [id, p] of Object.entries(PROMPTS)) if (id !== "ask") $("prompt").append(new Option(p.name, id));

let tab = null;

function bind(id, prop = "value", event = "change") {
  $(id).addEventListener(event, () => chrome.storage.sync.set({ [id]: $(id)[prop] }));
}

(async () => {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  $("ai").value = settings.ai;
  $("prompt").value = settings.prompt;
  $("autoSend").checked = settings.autoSend;
  $("timestamps").checked = settings.timestamps;
  $("language").value = settings.language;
  $("customPrompt").value = settings.customPrompt;

  bind("ai");
  bind("prompt");
  bind("autoSend", "checked");
  bind("timestamps", "checked");
  bind("language", "value", "input");
  bind("customPrompt", "value", "input");

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let onVideo = false;
  try {
    const url = new URL(tab.url);
    onVideo = url.hostname === "www.youtube.com" && url.pathname === "/watch" && url.searchParams.has("v");
  } catch {
    onVideo = false;
  }
  $("run").disabled = !onVideo;
  $("hint").textContent = onVideo ? "" : "Open a YouTube video to summarize it.";
})();

$("run").addEventListener("click", async () => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "yts:run" });
    window.close();
  } catch {
    $("hint").textContent = "This tab was open before the extension loaded. Reload it, then try again.";
  }
});
