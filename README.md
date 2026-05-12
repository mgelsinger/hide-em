# hide-em

A personal attention filter for the web. You add names, keywords, or phrases. Matching content disappears from any site you visit, shortly after it appears. Text matching only. Fully local. No backend.

## What it is

A Manifest V3 Chromium browser extension (Chrome, Brave, Edge, etc.) that runs a single universal content script on every page you load. The script walks text nodes, tests each against your blocklist, and on a match hides the nearest semantic card-like ancestor — `<article>`, `<li>`, ARIA `role="article"` / `role="listitem"`, or a custom element matching `*-RENDERER` / `*-CARD` (which catches YouTube tiles, Reddit cards, etc.).

The rules engine is platform-agnostic. There is no site-specific code anywhere in the codebase. Adding a new site is zero work.

## What it isn't

- Not a moderation tool, recommendation engine, or content classifier — it's a tool for one user, doing exactly what they configured.
- Not AI-based — exact text matching with Unicode normalization, no semantic models, no remote calls.
- Not a thumbnail blocker — text matching only. If the title doesn't say "Mr Beast," the tile isn't hidden.
- Not a community blocklist platform — your rules are your rules. JSON import/export is supported; sharing isn't a feature.

See the "Non-goals" section below for the long form.

## Status

- **Engine:** stable, 38 unit tests pass.
- **Scanner:** stable on YouTube, Reddit, generic article sites. Hides via `display: none` on the matched card.
- **Options page:** add/edit/delete rules, JSON import/export, debug toggle.
- **Popup:** not built yet.
- **Icons:** not designed yet — Chrome shows a generic puzzle icon.
- **Web Store:** not submitted. Currently distributed only as an unpacked extension.

## Install (unpacked, for personal use)

1. Clone this repo and build:
   ```sh
   npm install
   npm run build
   ```
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and select the `dist/` folder.
5. Click the extension's options entry (right-click the extension icon → **Options**) and add your first rule.

The extension takes effect immediately on the next page load. Existing tabs need a refresh.

## Usage

Open the options page. Each rule has:

| Field | What it does |
| --- | --- |
| **Type** | `creator` / `keyword` / `phrase` / `regex` |
| **Value** | The text to match (or a regex pattern, for `regex` type) |
| **Aliases** | Alternative forms — all matched as if they were the value |
| **Whole word** | `\b…\b` boundary — defaults to `true` for `creator` rules |
| **Case sensitive** | Defaults to `false` |
| **Scopes** | titles / channels / comments / descriptions — currently informational; the universal scanner tests all text against all scopes |

Use **Export** to download your rules as JSON; **Import** to round-trip them onto another machine.

### Debug overlay

Enable **Debug** in Settings, then on any page press **Alt + Shift + D** to toggle a small overlay showing `scanned`, `hidden`, and last batch time. Useful for verifying the scanner is doing work.

### Safety net (console)

The scanner exposes `window.__heDebug` on every page:

```js
__heDebug.stats     // live counters and state
__heDebug.kill()    // disable the scanner, disconnect the observer, remove all hides
__heDebug.unkill()  // re-enable
```

It also self-terminates if any single drain exceeds 1s or cumulative scan time exceeds 60s, surfacing a structured `console.warn` with the relevant counters. This is a deliberate failure mode — visible flash > blank page.

## How it works (short version)

```
┌────────────────────────────────────────────┐
│  Engine (src/engine/, src/shared/storage)  │
│  Pure logic. Compiles rules to one regex   │
│  per scope. No DOM imports.                │
└────────────────────────────────────────────┘
                    ▲
                    │ "does this text match?"
                    │
┌────────────────────────────────────────────┐
│  Universal scanner                         │
│  (src/content/universal-scanner.ts)        │
│  One content script, all sites.            │
│  TreeWalker-free, per-child decomposition, │
│  idle-callback yielding, kill-switches.    │
└────────────────────────────────────────────┘
```

## Development

```sh
npm install
npm run dev         # vite build --watch — rebuilds dist/ on file change
npm run build       # one-shot production build
npm run test        # vitest run — engine + shared utilities only
npm run typecheck   # tsc --noEmit
```

Reload the extension in `chrome://extensions` after each build (the reload icon on the card).

### Repository layout

```
src/
  background/             # service worker: storage subscriptions, lifecycle
  engine/                 # pure matcher — NO DOM imports allowed
  content/
    universal-scanner.ts  # the one content script — runs on all sites
    debug-overlay.ts      # optional stats overlay (Alt+Shift+D)
  ui/
    options/              # React app: full blocklist management, import/export
  shared/                 # storage wrapper, shared types
vite.config.ts            # manifest is defined inline here
```

### Architecture rules

1. **Universal scanner only.** One content script runs on all sites. No site-specific code anywhere.
2. **No pre-hiding.** Items are visible by default. Hidden only on a positive match.
3. **The engine never imports DOM types.** It is pure logic, testable in Node with no JSDOM and no Chrome API mocks.
4. **Per-file soft cap: 200 lines.** Split when it grows past that.

### Tests

```sh
npm run test
```

The engine has full coverage (rules, scopes, normalization edge cases including ZWJ, diacritics, fullwidth Unicode). The scanner is not unit-tested — it's DOM-coupled and JSDOM tests of `MutationObserver` behavior have low ROI. Verification is the kill-switch safety net + the debug overlay + manual smoke testing.

## Non-goals

Explicit non-goals — these will not be added without an explicit request and should never be introduced incrementally:

- No image or thumbnail OCR
- No face detection
- No AI or semantic matching of any kind
- No backend, telemetry, or cloud sync beyond `chrome.storage.sync`
- No community blocklist sharing
- No filtering of content you yourself authored
- No "auto-suggest blocks" — you add rules, the extension applies them
- No site-specific code paths or selectors

## Tech stack

- Manifest V3, Chromium-based browsers
- TypeScript, strict mode
- Vanilla DOM in the content script (no framework)
- React for the options page (off the hot path)
- `chrome.storage.sync` for rules, `chrome.storage.local` for hit counters
- Bundler: Vite + `@crxjs/vite-plugin`
- Tests: Vitest

## License

MIT — see [LICENSE](LICENSE).
