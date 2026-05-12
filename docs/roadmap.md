# Roadmap

Milestone-based plan. Each milestone is sized to be roughly one focused Claude Code session, sometimes two. Work end-to-end on a milestone before moving to the next. Check items off as they ship.

Model recommendation per milestone is included — Opus for architecturally consequential work, Sonnet for execution.

---

## Milestone 1 — Engine, storage, options page ✅
**Status:** done.
**Goal:** A working blocklist with no DOM filtering yet. User can add, edit, delete, import, export rules. Rules persist and sync via `chrome.storage.sync`.

- [x] Project scaffold: Vite + `@crxjs/vite-plugin`, TypeScript strict, manifest inline in `vite.config.ts`
- [x] `src/shared/types.ts` — `BlockRule`, `Platform`, `HideAction`, `RuleScope`, `CompiledRuleset`, `MatchResult`, `Settings`
- [x] `src/shared/storage.ts` — typed wrapper around `chrome.storage.sync` and `local`, with `onChanged` subscription helpers
- [x] `src/engine/normalize.ts` — Unicode NFKD, strip combining marks, strip zero-width, lowercase
- [x] `src/engine/matcher.ts` — `compile()`, `test()`, `testMulti()`, named-capture-group rule attribution
- [x] `src/engine/*.test.ts` — 38 unit tests covering creator/keyword/phrase/regex rules, all scopes, ZWJ, diacritics, fullwidth Unicode
- [x] `src/background/service-worker.ts` — minimal storage subscription stub
- [x] `src/ui/options/` — React app: list/add/edit/delete rules, JSON import/export, debug toggle, per-platform settings UI

---

## Milestone 2 — Universal content scanner ✅
**Status:** done. Replaces the original adapter-per-site plan. See `docs/decisions.md` D-027 for the architectural pivot.
**Goal:** One content script. Runs on every site. Walks text, tests against the engine, hides the nearest semantic card-like ancestor on a match.

- [x] `src/content/universal-scanner.ts` — single file, ~360 lines after instrumentation
- [x] `MutationObserver` on `document.documentElement` with `{ childList: true, subtree: true }`
- [x] Per-child scan decomposition so each `scanSubtree` call is bounded by direct-child count (D-030)
- [x] Microtask batching for new mutations; `requestIdleCallback` continuation when `scanSubtree` queues descendants (D-030)
- [x] Layout-free `findHideTarget` — semantic tags, ARIA roles, custom-element renderers; no `getBoundingClientRect` (D-031)
- [x] Self-mutation filter so the debug overlay's `textContent` update doesn't feedback-loop the scanner (D-032)
- [x] Hard kill-switches: any drain > 1s or > 60s cumulative disables the scanner and surfaces `console.warn` with structured counters
- [x] `window.__heDebug` console handle for live inspection and manual control
- [x] Debug overlay toggled with Alt+Shift+D

---

## Milestone 3 — Distribution and polish 🚧
**Status:** in progress.
**Goal:** Ship-ready as either an unpacked extension for personal use or a Web Store upload.

- [x] README
- [x] LICENSE
- [ ] Icon set (16 / 48 / 128) — currently the manifest has `"icons": {}`
- [ ] Popup UI: on/off toggle, quick-add field, hit count for current page
- [ ] Hit-counter persistence in `chrome.storage.local` (currently a stub)
- [ ] Schema-version migration helper in storage wrapper (for future schema changes)
- [ ] `collapse` and `blur` actions in addition to `hide`
- [ ] Screenshots for the Web Store listing (if pursuing that path)
- [ ] Privacy policy doc (only needed for Web Store)

**Definition of done:** you would not be embarrassed to share the extension with a friend or list it on the Web Store.

---

## Milestone 4 — Coverage gaps 🔍
**Status:** open. Tracking the failure modes of the layout-free `findHideTarget`.
**Goal:** Cover the small set of sites where the universal scanner currently misses hides, without reintroducing per-site code or layout reads.

The current target patterns are: `ARTICLE` / `LI` / `SECTION` / `FIGURE`, `role="article"` / `role="listitem"`, and custom elements ending in `-RENDERER` / `-CARD`. Text matches inside a generic `<div>` with none of those ancestors are not hidden. Known unaffected: YouTube (custom-element renderers), Twitter/X (`role="article"`), Reddit new (custom elements), most blogs (`<article>`). Known affected: TBD as users report sites.

- [ ] Document any site that should be hidden but isn't, with the smallest DOM snippet showing the problem
- [ ] Decide whether to extend the target-pattern set, or accept the miss
- [ ] Do **not** reintroduce `getBoundingClientRect` or any layout-flushing read — see D-031

---

## Milestone 5 — Optional: Web Store submission 🤔
**Status:** deferred. Pursue only if the user wants installs beyond their own machines.

- [ ] One-time $5 Chrome developer registration
- [ ] Justification text for the `<all_urls>` host permission ("text-matching content filter; no remote calls; no data collection")
- [ ] Privacy policy (zero-data-collection statement — required even for zero-collection extensions)
- [ ] Screenshots and store listing copy
- [ ] Submit unlisted, then promote to public if happy with it

---

## Deferred — revisit only on explicit request

- Per-rule hit counts in the options page (sort by frequency, "rules with zero hits" cleanup)
- Show-anyway override mechanism for blocked URLs
- Cross-machine encrypted blob export (beyond `chrome.storage.sync`)
- Firefox port (Manifest V3 differences are non-trivial)

---

## Explicit non-goals (do not implement)

These were considered and rejected. See `docs/decisions.md` D-017.

- Thumbnail OCR
- Face detection
- AI semantic matching
- Backend, telemetry, cloud sync
- Community blocklist sharing as a feature (vs. raw JSON import/export)
- Auto-suggested blocks based on viewing patterns
- Site-specific code paths or selectors (D-027 — adapter system was deliberately removed)
