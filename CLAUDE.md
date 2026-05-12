# hide-em — Personal Attention Filter

## What this is

A Chromium browser extension that hides content matching a user-defined blocklist on any website. Text matching only. No backend, no AI, no cloud. Fully local to the browser. This is a personal attention-hygiene tool — not a moderation tool, not a content classifier, not a recommendation engine. The user adds names, keywords, or phrases; matching content disappears from the page shortly after it appears, no per-site configuration required.

## Stack

- Manifest V3 Chrome extension (works in Brave and other Chromium browsers)
- TypeScript, strict mode
- No framework for the content script — vanilla DOM, for performance
- React for the options page (off the hot path, acceptable there)
- `chrome.storage.sync` for blocklist metadata, `chrome.storage.local` for caches and hit counters
- No external runtime dependencies in the content script unless absolutely necessary
- Bundler: Vite with `@crxjs/vite-plugin`

## Repo layout

```
src/
  background/             # service worker: storage subscriptions, message routing, lifecycle
  engine/                 # pure matcher — NO DOM imports allowed in this folder
  content/
    universal-scanner.ts  # the one content script — runs on all sites
    debug-overlay.ts      # optional stats overlay (Alt+Shift+D)
  ui/
    popup/                # quick add + on/off toggle
    options/              # full blocklist management, import/export
  shared/                 # storage wrapper, shared types
vite.config.ts            # manifest is defined inline here
docs/
  design.md               # architecture and rationale
  decisions.md            # running log of non-obvious decisions
  roadmap.md              # milestone plan
```

## Hard rules — do not violate

1. **Universal scanner only.** One content script runs on all sites. No site-specific code anywhere.

2. **No pre-hiding.** Items are visible by default. Hidden only on a positive match from the engine.

3. **MutationObserver on `document.body` is acceptable here** because we have no site-specific containers to scope to. Batch all mutations via microtask before processing.

4. **Processed nodes tracked in `WeakSet`.** Never scan the same node twice.

5. **The engine in `src/engine/` is never touched by content-script changes.** It is pure logic and must stay that way — testable in plain Node with no JSDOM and no Chrome API mocks.

6. **Performance budget: mutation batch processing under 10ms.** If exceeded, split across `requestIdleCallback` ticks.

## Conventions

- TypeScript strict mode on. No `any` unless interfacing with chrome APIs that genuinely return unknown.
- Functions over classes in the content script. The engine is functions-only.
- Per-file soft cap: 200 lines. Split when it grows past that.
- Tests live in `*.test.ts` next to the file. Test the engine and shared utilities. Don't unit-test DOM code — rely on manual verification.
- Logging: `console.debug` gated behind a `DEBUG` flag read from storage. No logging in production paths by default.

## Operating notes for Claude Code sessions

- Read `docs/design.md` before working on the engine or the scanner.
- Read `docs/decisions.md` before making any architectural change — many things have been deliberately chosen, and the rationale is logged there. If you disagree with a decision, raise it with the user; do not silently override.
- Log new non-obvious decisions in `docs/decisions.md` as you make them, with a one-or-two-sentence rationale.

## Explicit non-goals

These will not be added without an explicit request from the user, and should never be introduced incrementally:

- No image or thumbnail OCR
- No face detection
- No AI or semantic matching of any kind
- No backend, telemetry, or cloud sync beyond `chrome.storage.sync`
- No community blocklist sharing
- No filtering of content the user themselves authored
- No "auto-suggest blocks" — the user adds rules, the extension applies them
- No site-specific code paths or selectors

## Quick orientation for a new session

If you are starting fresh and don't know what to do next, read `docs/roadmap.md` and find the next unchecked milestone. Confirm with the user before starting a milestone, then work end-to-end on it before moving on.
