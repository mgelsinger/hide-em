# Architecture and Design

This is the deep reference. Read this before changing the engine or the scanner. For day-to-day rules, `CLAUDE.md` is canonical.

## Philosophy

Three principles drive every design choice:

**Personal, local, deterministic.** This is a tool for one user, running in their browser, doing exactly what they configured. No surprises, no probabilistic matching, no remote anything. If the user adds "Kim Kardashian," they get exact-text matching on that string and its aliases. Nothing more.

**Invisible when it works.** The user should never notice the extension is running. No scroll jank, no delayed page loads. If users can feel the extension working, we have failed regardless of correctness.

**Prefer visible flash over blank pages.** Items are visible by default and hidden only on a positive match. If the scanner fails, the worst outcome is a blocked item briefly shows. The former adapter system had the opposite failure mode — stuck "scanning" state left whole pages blank. That is the wrong direction for an attention filter.

## Two-layer architecture

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Rules store + matching engine                 │
│  (src/engine/, src/shared/storage.ts)                   │
│  Pure logic. No DOM. Testable in Node.                  │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ "does this text match?"
                          │
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Universal scanner                             │
│  (src/content/universal-scanner.ts)                     │
│  One content script, all sites, no site-specific code.  │
└─────────────────────────────────────────────────────────┘
```

There is no adapter layer. See D-027 in `docs/decisions.md` for why it was removed.

## The matching engine

### Data model

```typescript
type RuleType = 'creator' | 'keyword' | 'phrase' | 'regex';
type HideAction = 'hide' | 'collapse' | 'blur';

type RuleScope = {
  titles: boolean;
  channels: boolean;
  comments: boolean;
  descriptions: boolean;
};

type BlockRule = {
  id: string;
  type: RuleType;
  value: string;
  aliases: string[];
  enabled: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  platforms: Platform[] | 'all';
  scope: RuleScope;
  action: HideAction;
  hits: number;
  createdAt: number;
  updatedAt: number;
};

type CompiledRuleset = {
  byScope: Record<keyof RuleScope, RegExp | null>;    // case-insensitive regex per scope
  byScopeCS: Record<keyof RuleScope, RegExp | null>;  // case-sensitive regex per scope
  ruleIndex: Map<string, BlockRule>;
  groupToRuleId: Map<string, string>;                 // named capture group → rule id
  fingerprint: string;
};

type MatchResult =
  | { matched: false }
  | { matched: true; ruleId: string; matchedText: string };
```

### Normalization

Before any matching, text is run through:

1. Unicode NFKD (decomposes accented characters into base + combining marks)
2. Strip combining marks (`/\p{M}/gu`)
3. Strip zero-width characters: ZWJ, ZWNJ, ZWSP, BOM (`/[​-‍﻿]/g`)
4. Collapse whitespace to single spaces, trim
5. Lowercase (unless rule is `caseSensitive`)

This catches stylized fan text ("J‍ynxzi" with a ZWJ), diacritic variants, fullwidth Unicode, and mixed casing.

### Compilation

When the rule set changes:

1. Group enabled rules by scope.
2. Split into case-insensitive and case-sensitive buckets per scope.
3. For each bucket, build a single combined regex via alternation using named capture groups (`(?<r0>pattern)`). Named groups let `findMatch` attribute a hit back to a specific rule ID without a second pass.
4. Escape user input for `keyword` and `phrase` types. `regex` type rules are user-provided; validate length (200 char cap), reject nested quantifiers (`(a+)+` pattern), and compile inside try/catch.
5. Apply `\b` word boundaries for rules with `wholeWord: true`.

The fingerprint (FNV-1a hash of sorted rule fields) lets callers detect whether a recompile is needed.

### API

```typescript
// src/engine/matcher.ts
export function compile(rules: BlockRule[]): CompiledRuleset;
export function test(compiled: CompiledRuleset, text: string, scope: keyof RuleScope): MatchResult;
export function testMulti(compiled: CompiledRuleset, fields: Partial<Record<keyof RuleScope, string>>): MatchResult;
```

`testMulti` runs each scope in order (`titles → channels → comments → descriptions`) and short-circuits on the first match. In the universal scanner every text node is passed as all four scopes simultaneously (see "No scope semantics" in D-027).

## Universal scanner

### Bootstrap sequence

The script runs at `document_idle` (see D-029 for why not `document_start`). Bootstrap is two phases — kept structurally separate even though phase 1 is no longer time-critical, because the same code must survive a future move back to an earlier `run_at` if we ever solve the flash-vs-hang tradeoff:

**Phase 1 — synchronous, at script load:**

```typescript
injectHideStyle();   // appends <style id="__he-style">.__he-hidden{display:none!important}</style>

observer.observe(document.documentElement, { childList: true, subtree: true });
// documentElement, not body — defensive; correct at any run_at

if (document.body) pending.add(document.body);
```

**Phase 2 — async `init()`:**

```typescript
const [rules, s] = await Promise.all([getRules(), getSettings()]);
compiled = compile(rules);
settings = s;
// register onRulesChanged / onSettingsChanged callbacks
initReady = true;
schedule();   // drain the mutations queued during phase 1
```

The drain is gated on `initReady`, so no matching runs until compiled rules exist.

### Mutation handling and batching

```typescript
function handleMutations(mutations: MutationRecord[]): void {
  for (const m of mutations) {
    for (const added of m.addedNodes) {
      if (shouldQueue(added)) pending.add(added);
    }
  }
  if (initReady && pending.size > 0) schedule();
}
```

`shouldQueue` rejects text nodes that don't need scanning (SCRIPT, STYLE, SVG, etc.) and skips the extension's own elements (the hide stylesheet and the debug overlay).

Batching:

```typescript
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(drain);
}

function drain(): void {
  scheduled = false;
  const batch = Array.from(pending);
  pending.clear();
  const t0 = performance.now();
  for (let i = 0; i < batch.length; i++) {
    scanSubtree(batch[i]);
    if (performance.now() - t0 > BATCH_BUDGET_MS && i < batch.length - 1) {
      // over budget — defer the tail
      for (let j = i + 1; j < batch.length; j++) pending.add(batch[j]);
      scheduleIdle(drain);
      break;
    }
  }
}
```

`BATCH_BUDGET_MS = 8`. Overflow is deferred to `requestIdleCallback` (with a 100ms timeout fallback for browsers that lack it).

### Scanning

`scanSubtree(root)` does **not** walk the whole subtree. For an element root, it scans only its *direct* text-node children and pushes element children into `pending` for a future drain. This bounds per-call work to direct-child count, which is what makes the `BATCH_BUDGET_MS` check in `drain` actually constrain main-thread blocking. A subtree N levels deep is scanned across N+ drains, with the browser free to paint and respond to input between them. See D-030 for the failure mode that motivated this design.

`scanTextNode(node)` passes the text content as all four scope fields to `testMulti`. On a match it calls `findHideTarget`.

### Microtask vs idle-callback continuation

`drain` can chain itself in two ways:
- **Microtask continuation** — used when a mutation arrives and queues new work. Low latency; the new content gets a chance to be hidden before the next paint.
- **Idle-callback continuation** — used when `scanSubtree` decomposed a subtree and left descendants in `pending`. The browser gets a chance to paint and handle input between drains. Microtask chaining here would starve rendering on large DOMs.

### Hide target selection

`findHideTarget` walks from the matched text node's parent toward `document.body`. It is **layout-free** — no `getBoundingClientRect`, no DOM reads that could force a reflow. Three priority-ordered checks:

1. **Semantic card tags** — `ARTICLE`, `LI`, `SECTION`, `FIGURE`. Unambiguous content containers on most sites.

2. **ARIA role** — `role="article"` or `role="listitem"`. Covers sites that use generic `<div>` elements with semantic roles (e.g., Twitter tweets).

3. **Custom element renderer pattern** — tag contains a hyphen and ends with `-RENDERER` or `-CARD` (e.g., `YTD-RICH-ITEM-RENDERER`). Catches YouTube custom elements without site-specific selectors.

If none of these match, `findHideTarget` returns null and the text node is silently skipped. See D-031 for why the previous sized-block fallback was removed.

### Hide and rescan

`hide(el)` adds the `__he-hidden` CSS class and sets `data-he-state="hidden"`.

When rules or settings change, `rescanAll()` removes the class from all hidden elements, replaces the `processed` WeakSet with a fresh one, and re-queues `document.body` for a full rescan.

## Storage model

Two stores:

**`chrome.storage.sync`** — the blocklist and settings. Caps at ~100KB / ~512 items.

```typescript
// sync
{
  rules: BlockRule[];
  settings: Settings;      // enabled, defaultAction, debug, perPlatformEnabled
  schemaVersion: number;
}
```

**`chrome.storage.local`** — hit counters and overrides.

```typescript
// local
{
  hits: Record<string, number>;       // ruleId → count
  overrides: Array<{ url: string; until: number }>;
  lastImport: { at: number; ruleCount: number } | null;
}
```

Subscribe to `chrome.storage.sync.onChanged` in the content script to rebuild compiled rules when `rules` changes. Don't poll.

## Manifest shape

Defined inline in `vite.config.ts`; `@crxjs/vite-plugin` emits `dist/manifest.json`.

```json
{
  "manifest_version": 3,
  "name": "hide-em",
  "version": "0.1.0",
  "permissions": ["storage"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "service-worker-loader.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["assets/universal-scanner.ts-loader-<hash>.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "options_page": "src/ui/options/index.html"
}
```

No `css` array in the content scripts entry. The hide stylesheet is injected by the script itself at phase 1 so it is cleaned up automatically when the extension is disabled.

No `tabs`, no `webRequest`, no `activeTab`.

## Performance

- **Observer scope.** The observer uses `{ childList: true, subtree: true }` with no `characterData` or `attributes`. YouTube attribute storms (style changes, hover states, timeline ticks) are filtered at the browser level before they reach the callback.
- **Microtask batching.** All added nodes for a given JS task coalesce into one `Set` and drain together before the next paint. Typical feed scroll = one drain per rAF.
- **8ms budget.** If a batch runs long, the remaining nodes are moved back to `pending` and handed off to `requestIdleCallback`. The browser's idle scheduler ensures this doesn't compete with user interaction.
- **WeakSet.** Prevents re-scanning already-processed nodes. Memory is reclaimed automatically when DOM nodes are GC'd; no manual cleanup.
- **One `getBoundingClientRect` per candidate.** `findHideTarget` calls `getBoundingClientRect` only on block-level elements, and stops as soon as it finds one with the minimum size. Semantic card matches and custom-element matches bypass it entirely.

## What was removed and why

The previous architecture had three layers: engine, coordinator, and platform adapters. The adapter system grew five decisions (D-022 through D-026) in rapid succession as YouTube's DOM changed. The pattern — silent blank pages whenever a selector drifted — is the wrong failure mode for a personal attention filter.

The universal scanner replaced all of it: no adapters, no selectors files, no coordinator, no SPA navigation hooks, no pre-hide CSS files, no watchdog. See D-027 and D-028 in `docs/decisions.md` for the full rationale and accepted tradeoffs.

## Testing strategy

- **Engine: full unit coverage.** Every rule type, every scope, every normalization edge case. Target 100% line coverage in `src/engine/`.
- **Shared utilities: unit tested.** Storage wrapper, message bus.
- **Scanner: no unit tests.** It is DOM-coupled. Rely on manual smoke testing on real sites and the debug overlay (total scanned, total hidden, last batch time in ms).
- **No CI gates beyond `tsc` and engine tests.** Solo project, ship-when-ready.
