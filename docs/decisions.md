# Decisions Log

Non-obvious architectural choices, with rationale. Read before overriding any of these. If you change one, log the new decision and supersede the old entry.

Format: short title, status, one-or-two-sentence rationale. No need for ADR formality on a solo project.

---

## D-001 — Manifest V3, not V2
**Status:** accepted
**Context:** V2 is sunsetting; V3 is required for new Chrome Web Store submissions. Brave and other Chromium browsers support V3.
**Trade-off:** Service worker instead of persistent background page means we can't hold long-lived state in memory. We compensate by treating `chrome.storage` as the source of truth and recompiling rules on demand. This is fine for our access pattern.

---

## D-002 — TypeScript, strict mode
**Status:** accepted
**Rationale:** The matcher engine is the highest-leverage code in the project; type safety catches a category of bugs (scope mismatch, missing fields in `BlockRule`) that would otherwise show up as silent false negatives. Cost is a few minutes of build setup.

---

## D-003 — No framework in content scripts
**Status:** accepted
**Rationale:** Content scripts touch high-churn DOM on every page. React/Vue/Svelte all introduce work we don't need — we are not rendering UI inside the page, we are reading and hiding existing nodes. Vanilla DOM is faster, lighter, and removes a dependency.
**Exception:** the options page uses React. It's off the hot path.

---

## D-004 — Engine has no DOM imports
**Status:** accepted
**Rationale:** Strict separation lets us unit-test the engine in plain Node with zero mocking. Matching bugs are the worst kind (silent false negatives, users assume rules work); we need them caught by tests.
**Mechanism:** lint rule or convention. If a future change needs DOM in the engine, the logic belongs in an adapter or the coordinator instead.

---

## D-005 — Scoped MutationObservers, never on `document.body`
**Status:** accepted
**Rationale:** YouTube fires thousands of mutations per second during scroll. A body-scoped subtree observer processes all of them, including chat reactions, tooltip mounts, button hover states. Scoping to the feed grid container alone reduces fired callbacks by ~99%.
**Mechanism:** `adapter.getObserverRoots()` returns the specific containers. Coordinator never queries `document.body` directly.

---

## D-006 — Microtask batching, not setTimeout
**Status:** accepted
**Rationale:** `setTimeout(fn, 0)` gets de-prioritized when the page is busy, leading to visible hide-flicker on fast scrolls. Microtasks run before the next paint, so a tile that mounted and a scan that hides it land in the same frame. The user never sees the unfiltered state.
**Exception:** low-priority work (deep comment threads, off-screen content) uses `requestIdleCallback` with a 100ms timeout.

---

## D-007 — `document_start` pre-hide CSS
**Status:** accepted
**Rationale:** The single biggest UX risk is flicker — content paints, then disappears. Injecting CSS before the site's own CSS, targeting content containers, hides everything by default. We reveal only what passes scan. The cost is a brief blank state during initial load, which is invisibly fast in practice.
**Counter:** if scan never runs (bug), feed stays blank. Watchdog (D-009) catches this.

---

## D-008 — WeakSet for processed nodes
**Status:** accepted
**Rationale:** We must not re-scan nodes we've already processed (wastes CPU, and on SPA-style apps that reuse DOM nodes, could re-trigger hide animations). Regular Set would leak memory because nodes are detached but not GC'd. WeakSet lets the GC handle it automatically.

---

## D-009 — 2-second watchdog for stuck "scanning" state
**Status:** accepted
**Rationale:** Hiding all content by default is great UX when it works, terrible UX when it doesn't. The watchdog is a circuit breaker: if scan hangs or errors, content is revealed after 2 seconds and the failure is logged. We prefer to show unwanted content occasionally rather than show nothing.

---

## D-010 — One combined regex per scope, recompiled on rule change
**Status:** accepted
**Rationale:** Looping N rules across M text fields is O(N×M) per item. Alternation regex is O(M) per item regardless of N. For a 100-rule blocklist on a YouTube homepage with 50 visible items, this is a 100x speedup.
**Mechanism:** subscribe to `chrome.storage.onChanged`; rebuild compiled regex only when the `rules` key changes.

---

## D-011 — Unicode NFKD normalization before matching
**Status:** accepted
**Rationale:** Stylized text ("Jynxzí", "J‍ynxzi" with ZWJ, fullwidth Unicode) is common in fan content. Without normalization, the false-negative rate is high enough that users notice. The normalization pass is ~microseconds per text field; cost is negligible.
**Pass order:** NFKD → strip combining marks → strip zero-width → collapse whitespace → lowercase (if not case-sensitive).

---

## D-012 — `wholeWord: true` default for creator rules
**Status:** accepted
**Rationale:** A "Tom" rule with substring matching hides half the internet. Word-boundary default makes creator rules safe by default. User can opt out per-rule if they want substring matching for handles like "@jynx" matching "@jynxzi".

---

## D-013 — `chrome.storage.sync` for rules, `local` for caches and hits
**Status:** accepted
**Rationale:** Sync gets the user's rules across devices automatically — a real feature for free. Hit counters and "show anyway" overrides don't need to sync and could push us over the 100KB sync cap. Split storage is the right structure.
**Future:** if a user crosses 400 rules, options UI warns and offers `local`-only mode with manual export.

---

## D-014 — No unit tests for adapters or coordinator
**Status:** accepted
**Rationale:** JSDOM tests of MutationObserver behavior have low ROI — they pass when the code is wrong against real sites, and the cost to maintain is high. We get coverage from manual smoke testing + the runtime watchdog + a debug overlay. The engine, by contrast, has full unit coverage because it's pure logic.

---

## D-015 — Idempotent hide and markClean
**Status:** accepted
**Rationale:** The coordinator may revisit a node after a rule change (to re-apply or un-apply). Adapter methods must be safe to call twice. We use `data-he-state` as the source of truth: read it, transition only if valid.

---

## D-016 — Selectors live only in `platforms/<site>/selectors.ts`
**Status:** accepted
**Rationale:** Sites change their DOM. When they do, we want exactly one file to edit. No selector strings inline in adapter logic, in CSS that isn't pre-hide, or anywhere else.

---

## D-017 — No AI, OCR, or remote services in MVP or v2
**Status:** accepted
**Rationale:** Scope creep risk. Text matching catches the vast majority of what users actually want to block. Adding AI introduces model weight, latency, accuracy variance, and platform-specific integration cost. If text matching proves insufficient after a year of use, revisit. Not before.

---

## D-018 — Show-anyway overrides are per-URL and time-bounded
**Status:** accepted
**Rationale:** When the user clicks through to a blocked item deliberately, we shouldn't keep hiding the page they're on. But we also shouldn't permanently exempt — the user might forget. Time-bounded (24 hours) override on the specific URL is the right middle ground.

---

## D-019 — Embeds on third-party sites: skip in MVP
**Status:** accepted
**Rationale:** Embedded YouTube/Twitter on news sites is a different DOM lifecycle, often inside iframes we can't easily reach with content scripts. Marginal value vs. high complexity. Revisit only if a user requests it specifically.

---

## D-020 — Per-platform on/off toggles in settings
**Status:** accepted
**Rationale:** A user might want filtering aggressively on Twitter but not on Reddit. Per-platform enable/disable is one boolean per platform and adds significant user control for tiny code cost.

---

## D-021 — Pre-hide CSS injected via manifest, not by the adapter at runtime
**Status:** accepted
**Rationale:** The `PlatformAdapter` contract carries a `preHideCSS: string` field, but in practice the stylesheet ships via `content_scripts[].css` in the manifest. Manifest-driven injection lands strictly before content-script JS executes, which is what the flicker contract requires. Programmatic injection from JS would race against the site's own stylesheet and lose. The field stays on the interface as documented metadata and as an escape hatch for adapter-specific CSS that needs to be added at runtime.

---

## D-022 — M2 YouTube adapter scopes by selector presence, not pathname
**Status:** accepted
**Rationale:** Milestone 2 ships only the `ytd-rich-item-renderer` tile selector, but tiles of that type appear on `/`, `/feed/subscriptions`, and `/feed/trending` — all rooted in `ytd-rich-grid-renderer`. Gating the adapter on `location.pathname === '/'` would let the global pre-hide CSS keep tiles invisible on the other two pages until the watchdog fired. Instead, the adapter scans wherever the grid root exists; surfaces with different item types (search, watch, channel) get no observer and remain unaffected. Other surfaces land in M3 with their own selectors.

---

## D-023 — Three-level channel-name fallback in YouTube adapter
**Status:** accepted
**Rationale:** On the homepage, `ytd-channel-name a` reliably provides an anchor whose `textContent` is the channel name. On `/feed/subscriptions`, YouTube renders channel names without an anchor child — the `ytd-channel-name` element is present but has no `<a>` inside it, so the primary selector silently returns null and `signals.channels` is never populated. We now try `ytd-channel-name a` → `#channel-name` → `ytd-channel-name` (whole element). The element's `textContent` is always the bare channel name regardless of whether an anchor is present.

---

## D-024 — Lockup component title fallback (`ytLockupMetadataViewModelTitle`)
**Status:** accepted
**Rationale:** YouTube changed the subscriptions feed (and possibly other surfaces) to use a new Lockup component. Video titles now appear in `<a class="ytLockupMetadataViewModelTitle"><span class="ytAttributedStringHost ...">TITLE</span></a>` instead of `#video-title`. The `#video-title` selector is tried first (homepage and legacy surfaces still use it); `.ytLockupMetadataViewModelTitle span` is the fallback. Using the `span` rather than the anchor avoids picking up the anchor's href or other attributes, and the `textContent` of the span is the bare title string. No `aria-label` equivalent is present on this element.

---

## D-025 — Channel page observer root and item selector
**Status:** accepted
**Rationale:** Channel video pages (`/@handle/videos`) use `ytd-grid-renderer #items` as the grid container with `ytd-grid-video-renderer` as the item type, not the `ytd-rich-grid-renderer` / `ytd-rich-item-renderer` used on the homepage. Because `getObserverRoots()` only returned the home-feed root, the scanner never ran on channel pages, leaving all tiles blank indefinitely (pre-hide CSS hides items with no `data-he-state`, and the watchdog only rescues items stuck in `data-he-state="scanning"`, not items that were never processed at all). `ITEM_SELECTORS` includes both item types. Title and channel extraction selectors are identical for both item types.
**Observer root dispatch:** `getObserverRoots()` uses `location.pathname` to decide which root selector to try. The two selectors must not be queried simultaneously: `ytd-grid-renderer #items` can match a nested grid inside the Shorts shelf on the homepage, causing false root attachment and missing mutations on the main feed. Channel-page URLs match `^\/@`, `^\/c\/`, `^\/channel\/`, or `^\/user\/`; everything else uses the home-feed root.

---

## D-026 — Watchdog covers both `:not([data-he-state])` and `[data-he-state="scanning"]`
**Status:** superseded by D-027
**Rationale:** The pre-hide CSS hides items in two states: explicitly `scanning` AND missing attribute (never processed). The original watchdog only queried `[data-he-state="scanning"]`, so items that the observer never touched — e.g., when root attachment failed or the page type was unrecognised — stayed blank indefinitely. The compound selector covers both states for every item type in `ITEM_SELECTORS`, making the watchdog a true circuit breaker for any scan failure mode.

---

## D-027 — Universal scanner replaces the platform-adapter system
**Status:** accepted, supersedes D-005, D-007, D-009, D-014, D-016, D-021, D-022, D-023, D-024, D-025, D-026
**Context:** Iterations on the YouTube adapter alone produced D-022 through D-026 in rapid succession as YouTube DOM changed (Lockup component, subscriptions-feed channel-without-anchor, channel page using a different grid root, nested `ytd-grid-renderer` causing false root matches on the homepage). Each fix was correct in isolation, but the pattern — silent blank pages whenever a selector drifted, recurring breakage on a stable site, growing per-site complexity — made the adapter approach unsustainable for a personal tool.

**Decision:** Delete the adapter system entirely. Replace with one content script (`src/content/universal-scanner.ts`) that runs on `<all_urls>` at `document_idle`. It walks text nodes with a `TreeWalker`, tests each piece of text against the matcher under all four scopes, and on a match walks up the DOM to the nearest block-level ancestor (tag allowlist + 40×100px size threshold via one `getBoundingClientRect`) and sets `display: none`. A single `MutationObserver` on `document.body` (`childList: true, subtree: true`) catches new content, batched via microtask with a 10ms budget and `requestIdleCallback` spill.

**Why this is better for this project:**
- **No site-specific knowledge required.** Adding a new site is zero work.
- **No blank pages.** Items are visible by default; failure mode is "the blocked thing briefly shows," not "the whole page is blank." This is the right failure direction for an attention filter.
- **Far less code.** No adapters, no selectors files, no SPA navigation hooks, no per-platform docs, no pre-hide CSS, no watchdog, no coordinator. One file replaces all of it.
- **Resilient to DOM changes.** Site redesigns don't break us — text matching cares about rendered text, not class names.

**Tradeoffs accepted:**
- **Visible flash.** Because we scan at `document_idle` rather than pre-hiding at `document_start`, a blocked item appears briefly before being hidden. On fast pages this is sub-100ms; on slow pages it can be several hundred ms. This is honest, not "typically under 100." The user explicitly prefers this over the blank-page failure mode of the previous approach.
- **Possible over-hiding.** A single text match takes down the nearest block-level ancestor. A blog article about a blocked creator gets hidden in full, which is correct for an attention filter and incorrect for a moderation tool — this project is the former.
- **Body-scoped observer cost.** D-005's concern about thousands of mutations per second on YouTube applies in theory, but in practice we observe `childList: true` only (not `characterData` or `attributes`), so most YouTube noise (style/attribute changes, timeline updates) is filtered at the browser level. Microtask batching and the 10ms budget keep us off the main thread.
- **No scope semantics.** Each text node is tested against rules under every scope. A rule scoped to "titles only" will now match against comment text or descriptions too. For a creator-name blocklist this is usually what the user wants; for narrowly-scoped keyword rules it's a regression. Acceptable for now.
- **Engine fingerprint and `byScopeCS` paths exist but go unused** in the universal scanner. Left in place because the engine is a pure module that may serve future use cases (e.g., a uBO-style CSS-generation path if performance ever forces it).

**Files deleted:** `src/platforms/` (entire folder, including the YouTube adapter, selectors, navigation, and pre-hide CSS), `src/content/coordinator.ts`, `src/content/bootstrap.ts`, `docs/platforms/`.
**Files retained:** `src/engine/` (untouched — pure logic), `src/shared/` (untouched), `src/ui/` (untouched), `src/background/` (untouched), `src/content/debug-overlay.ts` (platform-agnostic, reused by the scanner).
**Now stale, not yet rewritten:** `docs/design.md` describes the three-layer architecture that no longer exists. It should be either rewritten to describe the universal scanner or removed in a follow-up.

---

## D-028 — Universal scanner bootstraps at `document_start`, not `document_idle`
**Status:** superseded by D-029
**Context:** D-027 originally specified `document_idle` to keep the scanner simple — wait for the body, attach a `MutationObserver`, scan. In practice this widened the visible-flash window: on slow pages the scanner woke after several hundred ms of the page already being interactive, and a slug of blocked content could paint and stay visible while the script downloaded and parsed.
**Decision:** Run the content script at `document_start`. Bootstrap is split into two phases:
  1. **Synchronous, at script load** — inject the `display: none` stylesheet, attach a single `MutationObserver` on `document.documentElement` (body may not exist yet), and seed `pending` with `document.body` if it does exist.
  2. **Asynchronous `init()`** — load rules + settings, compile, register storage subscriptions, set `initReady = true`, and trigger the first drain.
Mutations that fire between phase 1 and phase 2 queue into `pending` without scanning. The drain is gated on `initReady` so we never test text against a missing compiled ruleset. The observer is attached to `documentElement` rather than `body` only because at `document_start` `body` is not guaranteed to exist — this is not a return to D-005's body-scoped concern, which was about observer *cost*, not target.
**Why this is safe:** the engine and storage layer are pure modules with no top-level side effects; their import cost at `document_start` is negligible. The synchronous bootstrap touches only `document.documentElement` and a tiny `<style>` node — no layout, no measurement.
**Manifest:** `run_at: "document_start"` in `vite.config.ts`. No `content_scripts[].css` entry; the stylesheet is injected from the script itself so that disabling the extension cleanly removes it.

---

## D-029 — Revert to `document_idle`; `document_start` hung large pages
**Status:** accepted, supersedes D-028
**Context:** D-028 moved the content script to `document_start` to reduce the visible-flash window. In testing, this caused YouTube and similar large-DOM sites to hang for many seconds — long enough for Chromium to surface its "page is unresponsive" dialog.

**Root cause:** at `document_start` the `MutationObserver` (`childList: true, subtree: true` on `document.documentElement`) is attached *before* the body parses. Every node the HTML parser inserts — thousands of them, on YouTube — fires a mutation. `handleMutations` queues each one into `pending`. When `init()` finally resolves and the first `drain()` runs, the batch contains `document.body` plus thousands of its descendants. `scanSubtree(document.body)` walks the entire DOM with a single `TreeWalker` in one synchronous call. The 8ms budget check sits *between* batch items, not inside `scanSubtree`, so it never fires for that first item. The main thread is held for the full walk, during which the browser hasn't yet painted (because the script is at `document_start` and is hogging the thread), so the page appears hung.

`document_idle` avoids the problem on all counts: the page is already parsed and interactive when the script wakes; the observer never sees the initial-parse mutation storm; and the first batch contains only `document.body`, scanned against an already-quiescent DOM where the work fits comfortably.

**Decision:** Revert `run_at` to `document_idle` in `vite.config.ts`. Accept the visible flash documented in D-027 as the correct tradeoff for this project.

**What we are NOT doing:**
- Not adding mid-`scanSubtree` yielding. The scanner code as written (synchronous bootstrap, observer on `documentElement`, body-may-not-exist handling) remains correct and is left in place. It works for either `run_at` value; only the manifest field changed.
- Not adding a fancy two-phase observer attach (defer observer until `DOMContentLoaded`). Simpler to defer the whole script.
- Not re-attempting `document_start` until/unless we have a real flash-reduction mechanism that survives a 50,000-node initial DOM.

**Manifest:** `run_at: "document_idle"` in `vite.config.ts`.

---

## D-030 — `scanSubtree` decomposes per-child instead of TreeWalking the whole subtree
**Status:** accepted
**Context:** Even after D-029 reverted to `document_idle`, YouTube and similar large-DOM sites still rendered blank with a RAM spike. Same root cause shape as D-029 but a different code path: `scanSubtree(document.body)` ran a single `TreeWalker` over every text descendant of body in one synchronous call. On YouTube that is tens of thousands of text nodes, each invoking `testMulti` (8 normalize + regex tests) and, on a match, `findHideTarget` (walks ancestors, calls `getBoundingClientRect` which forces layout). The `BATCH_BUDGET_MS` check in `drain()` sits between batch items and is never reached while the single mega-walk is in flight. Main thread held → no paint → blank tab; per-text-node allocations during the walk → RAM spike.

**Decision:** `scanSubtree` no longer recurses. For an element root, it scans only its *direct* text-node children and pushes element children into `pending` for a future drain. Each call is bounded by direct-child count (small in practice), so the existing `BATCH_BUDGET_MS = 8` check actually constrains main-thread blocking. Continuation between drains uses `requestIdleCallback`, not `queueMicrotask` — chained microtasks would keep starving the renderer even with bounded per-call work, because microtasks don't yield to paint.

**Other changes in the same edit:**
- Early bail on `!el.isConnected` so detached nodes don't waste a scan.
- The TreeWalker `acceptNode` filter is gone; its checks (length, trim, skip-tag parent) move inline into the per-child loop or are subsumed by the per-call element gate (`SKIP_TAGS`, `HIDDEN_CLASS`).
- The `acceptNode` check for `parent.classList.contains(HIDDEN_CLASS)` is preserved at the element-queue level (we don't queue hidden children). Text under an already-hidden direct parent can't appear because hidden elements are not entered.

**Tradeoff:** A deep subtree now takes (depth) drains to fully scan instead of one. With ~16ms idle gaps between drains, the full initial scan of a YouTube homepage stretches to a few seconds wall-clock — but the page remains responsive throughout, paints normally, and blocked content disappears in waves rather than all at once. This is consistent with the D-027 failure-direction preference: visible flash > blank page.

**Microtask vs idle callback rule:**
- New mutations from the page → `queueMicrotask(drain)`. Low latency, hides new content before paint when possible.
- `pending` not empty after a drain (because `scanSubtree` queued descendants) → `requestIdleCallback(drain)`. Yields to the browser so rendering and user input can interleave.

---

## D-031 — `findHideTarget` is layout-free; no `getBoundingClientRect` fallback
**Status:** accepted
**Context:** With D-030 in place, large-DOM sites still hung partway through loading. The remaining culprit was layout thrashing inside `findHideTarget`. Its "sized block fallback" called `getBoundingClientRect` on every block-level ancestor of a matched text node, looking for one ≥40×100px. `getBoundingClientRect` flushes pending layout. Worse, hides interleaved with reads — `hide()` writes a class, the next `findHideTarget` reads a rect, the browser must recompute layout. Classic read/write thrash. On a page with hundreds of matches, the cumulative forced-layout cost was easily seconds.

**Decision:** Remove the sized-block fallback entirely. `findHideTarget` is now pure DOM traversal: walk up ancestors and return the first `ARTICLE` / `LI` / `SECTION` / `FIGURE`, or `role="article"` / `role="listitem"`, or custom element matching `*-RENDERER` / `*-CARD`. If none of those match, return null and skip the hide. No `getBoundingClientRect`, no `BLOCK_LEVEL_TAGS`, no `MIN_HIDE_WIDTH`/`MIN_HIDE_HEIGHT`.

**Tradeoff:** Text matches inside a generic `<div>` with no semantic wrapper, no ARIA role, and no custom-element ancestor will no longer be hidden — the user will see the text. This is a real regression from the previous "anything block-level is fair game" behavior, but it is far better than freezing the tab. Major sites the user actually browses (YouTube → custom-element renderers; Twitter → `role="article"`; Reddit new → custom elements; blogs → `<article>`) all hit the cheap paths. The pattern that loses coverage is unstructured page text inside `<div>` soup, which is the failure mode least worth preserving for an attention filter.

**Also in this edit:** `scanSubtree` now calls `el.closest('.__he-hidden')` before processing. Once a card is hidden, we don't waste drains walking its descendants. `closest` is O(depth) so this is a clear win when matches are concentrated in a few cards (the common case).

**Tracking:** if the user later reports a site that should be hidden but isn't, revisit by adding a single, layout-free DOM signal — e.g., a `data-testid` allowlist or a `class*=` match — rather than reintroducing rect calls. A read-batched fallback (collect all matches per drain → one read pass → one write pass) is a real option but adds complexity and isn't justified until the layout-free path proves insufficient.

---

## D-032 — Mutation filter must exclude text nodes inside our own elements
**Status:** accepted
**Context:** Even with D-030 (per-child decomp) and D-031 (no rect calls) in place, the page still locked up — but the reason was nothing to do with scanning cost. Instrumentation revealed the actual signature on YouTube and Reddit: `drainCount ≈ 1,800,000`, `mutationsObserved ≈ 1,800,000`, `batchLength: 1` and `processedInBatch: 1` on every drain, `totalHidden: 0`. A million-iteration tight feedback loop, doing nothing useful.

**Root cause:** the debug overlay. `DebugOverlay.update()` writes `el.textContent = ...` every drain. Setting `textContent` removes the old child text node and inserts a new one — a `childList` mutation. The overlay lives in `document.documentElement`, which the scanner observes with `subtree: true`. `shouldQueue` rejected the overlay *element* by ID but didn't reject *text nodes inside* the overlay (it returned `true` for any text node, unconditionally). So:
  1. `drain()` ends → `overlay.update()` sets `textContent`
  2. mutation fires for the new text-node child of the overlay
  3. `handleMutations` queues the text node into `pending` and schedules a microtask drain
  4. drain scans that one text node, finds no match, ends, calls `overlay.update()` again
  5. goto 2

This is microtask-driven (MutationObserver callback → microtask → `queueMicrotask(drain)` → microtask), so it starves tasks and timers. The 3-second `setInterval` AUTO-KILL never fired, the page never painted, the kill-switches only tripped once one drain crossed 250ms by accident.

**Decision:** Two filters in the scanner, redundant on purpose:
1. `shouldQueue` rejects text nodes whose direct parent is our overlay or our stylesheet.
2. `handleMutations` skips entire `MutationRecord`s whose `target` is our overlay or our stylesheet (catches characterData mutations too, in case we ever start observing them).

The constants `OVERLAY_ID` and `STYLE_ID` are now both referenced from both filters; a future addition of a hide-em-owned element must update both places (or pull both into a shared `isOwnElement` helper).

**Also removed in this edit:** the temporary auto-diagnostic timer that fired every 1s and called `__heDebug.kill()` at 3s. It existed only to surface this bug. The kill-switches and `__heDebug` console handle remain as a permanent safety net. Thresholds restored to `HARD_KILL_DRAIN_MS = 1000`, `HARD_KILL_TOTAL_MS = 60000`, `SLOW_DRAIN_THRESHOLD_MS = 100`. `MAX_TEXT_LEN = 5000` stays — capping pathological text nodes is cheap defense and doesn't cost real coverage.

**Future trap:** if anyone adds another hide-em element to the page (a popup, a banner, anything inside `documentElement`), they must add its id to the filter. The right refactor at that point is to wrap our owned elements in a single host element and exclude that one host from the observer — not to keep growing the ID list.
