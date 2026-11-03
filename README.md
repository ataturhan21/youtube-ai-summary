# YouTube AI Summary

A Chrome extension that adds a **✦ Summarize** button to YouTube videos. One click reads the video's transcript, opens your AI chat of choice in a new tab, pastes a summary prompt with the full transcript and sends it.

- **AI sites:** ChatGPT, Claude, Gemini, Grok, DeepSeek and Perplexity. It uses your own signed-in account, so there's no API key and nothing to pay for.
- **Prompts in the ▾ menu:**
  - Summary (TL;DR, key points with timestamps, takeaways)
  - Key points
  - Study notes with a quiz
  - Ask a question about the video
  - Your own prompt
- **Copy transcript** puts the clean transcript on your clipboard.
- **Timestamps:** the transcript is grouped into ~30-second paragraphs with `[m:ss]` timestamps and chapter headings, so answers can point to moments in the video.
- **Shortcut:** `Alt+Shift+S` summarizes the video in the current tab. You can change it at `chrome://extensions/shortcuts`.
- **Settings** (toolbar popup): default AI, default prompt, send automatically or leave the prompt in the chat box, timestamps on or off, answer language, and your own prompt.
- **Videos without a transcript:** the AI gets the video link instead. Gemini can watch YouTube links itself.

## Install

1. Download `youtube-ai-summary-<version>.zip` from the [latest release](../../releases/latest) and unzip it, or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder.

YouTube tabs that are already open get the button right away.

## Privacy

The transcript goes only to the AI site you pick, in a tab of your own browser. The extension has no server, no analytics and no tracking. Prompts waiting to be pasted are held in Chrome's in-memory session storage and deleted as soon as the AI tab picks them up. Permissions:
- `storage` for your settings,
- `scripting` to add the button to YouTube tabs that were already open,
- access to youtube.com and the six AI sites.

## How it works

- **[`extension/youtube.js`](extension/youtube.js)**
  - Adds the button next to the video's like and share buttons.
  - When clicked, it opens YouTube's own *Show transcript* panel, reads the lines and chapter titles, and closes the panel again. YouTube's caption APIs now reject requests from outside the player, so reading the panel is the reliable way in.
  - It reads only the visible transcript list, because YouTube keeps an old video's list and duplicate lists in the page.
- **[`extension/shared.js`](extension/shared.js)** turns the lines into paragraphs and builds the prompt. Pure functions, unit-tested.
- **[`extension/background.js`](extension/background.js)** opens the AI tab and holds the prompt for it.
- **[`extension/ai.js`](extension/ai.js)**
  - Runs on the AI site, picks up the prompt and pastes it into the chat box in one step, so long transcripts are instant and ChatGPT can turn them into an attachment.
  - Then clicks send, or presses Enter when the site has no send button.
  - Chat sites redesign often, so when the known selectors miss, it falls back to the largest text box and the nearest "send" button.

## Development

```bash
npm test          # unit tests for transcript formatting and prompt building
npm run check     # manifest parses and every script compiles
```

Browser harnesses (serve the repository root with `python -m http.server 8765`):

- `test/ai-harness.html?mode=rich|textarea|enter` (add `&autoSend=0`): mock chat pages for the paste-and-send step.
- `test/popup-harness.html?url=…` (add `&loaded=0`): the real popup with stubbed Chrome APIs.

The YouTube side was checked on live youtube.com pages, including moving between videos without reloading the page and pages with an ad playing.

## Limits

- Needs a video with captions (auto-generated ones count). Shorts and live streams aren't supported.
- If an AI site changes its page, the paste can fail. When that happens, the prompt is also on your clipboard, so you can paste it yourself.

## License

MIT
