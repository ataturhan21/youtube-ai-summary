// Opens the AI chat tab and hands the prompt to it. Jobs are kept in session storage, keyed by
// tab id, so they survive the service worker going to sleep and are never written to disk.
importScripts("shared.js");

const jobKey = (tabId) => `job:${tabId}`;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;

  if (msg.type === "yts:open") {
    (async () => {
      const ai = self.YTS.AIS.find((a) => a.id === msg.ai) || self.YTS.AIS[0];
      const opener = sender.tab;
      const tab = await chrome.tabs.create({
        url: ai.url,
        index: opener ? opener.index + 1 : undefined,
        openerTabId: opener ? opener.id : undefined
      });
      await chrome.storage.session.set({ [jobKey(tab.id)]: { text: msg.text, autoSend: Boolean(msg.autoSend) } });
      reply({ ok: true });
    })().catch(() => reply({ ok: false }));
    return true;
  }

  if (msg.type === "yts:take" && sender.tab) {
    (async () => {
      const key = jobKey(sender.tab.id);
      const stored = await chrome.storage.session.get(key);
      if (stored[key]) await chrome.storage.session.remove(key);
      reply(stored[key] || null);
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(jobKey(tabId)));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "summarize") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "yts:run" }).catch(() => {});
});

// Make the button appear in YouTube tabs that were already open when the extension was installed.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["shared.js", "youtube.js"] })
      .catch(() => {});
  }
});
