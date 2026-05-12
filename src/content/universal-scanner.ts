import { compile, testMulti } from '../engine/matcher.js';
import { DebugOverlay } from './debug-overlay.js';
import {
  getRules,
  getSettings,
  onRulesChanged,
  onSettingsChanged,
} from '../shared/storage.js';
import type {
  CompiledRuleset,
  RuleScope,
  Settings,
} from '../shared/types.js';

const STATE_ATTR = 'data-he-state';
const HIDDEN_CLASS = '__he-hidden';
const STYLE_ID = '__he-style';
const OVERLAY_ID = 'he-debug-overlay';
const MIN_TEXT_LEN = 2;
const BATCH_BUDGET_MS = 8;

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'SVG', 'CANVAS',
  'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'META', 'LINK',
  'TITLE', 'HEAD',
]);

const SEMANTIC_CARD_TAGS = new Set(['ARTICLE', 'LI', 'SECTION', 'FIGURE']);

let compiled: CompiledRuleset | null = null;
let settings: Settings | null = null;
let processed = new WeakSet<Node>();
const pending = new Set<Node>();
let scheduled = false;
let initReady = false;
let totalScanned = 0;
let totalHidden = 0;
const overlay = new DebugOverlay();

// --- Diagnostics (D-032 instrumentation pass) ---
// Goal: identify which of {match cost, mutation flood, rescan loop, hide-target walk
// depth, pending growth} actually pins the thread on YouTube.
const HARD_KILL_DRAIN_MS = 1000;
const HARD_KILL_TOTAL_MS = 60000;
const SLOW_DRAIN_THRESHOLD_MS = 100;
const MAX_TEXT_LEN = 5000;
let killed = false;
let drainCount = 0;
let totalDrainMs = 0;
let maxDrainMs = 0;
let maxPendingSize = 0;
let rescanCount = 0;
let lastRescanAt = 0;
let findHideTargetCalls = 0;
let findHideTargetSteps = 0;
let mutationCallbackCount = 0;
let mutationsObserved = 0;

function injectHideStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
  document.documentElement.appendChild(style);
}

function shouldQueue(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    // Text nodes inside our own elements must not queue, or overlay.update()
    // sets textContent → mutation → drain → overlay.update() → ... (D-032).
    const parent = node.parentElement;
    if (parent && (parent.id === OVERLAY_ID || parent.id === STYLE_ID)) return false;
    return true;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  if (SKIP_TAGS.has(el.tagName)) return false;
  if (el.id === STYLE_ID || el.id === OVERLAY_ID) return false;
  return true;
}

function handleMutations(mutations: MutationRecord[]): void {
  if (killed) return;
  mutationCallbackCount++;
  mutationsObserved += mutations.length;
  for (const m of mutations) {
    // Skip mutations whose target is one of our own elements (D-032).
    if (m.target instanceof Element) {
      const id = m.target.id;
      if (id === OVERLAY_ID || id === STYLE_ID) continue;
    }
    for (const added of m.addedNodes) {
      if (shouldQueue(added)) pending.add(added);
    }
  }
  if (pending.size > maxPendingSize) maxPendingSize = pending.size;
  if (initReady && pending.size > 0) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(drain);
}

function drain(): void {
  if (killed) {
    scheduled = false;
    return;
  }
  scheduled = false;
  if (!compiled || !settings) return;

  const startSize = pending.size;
  const batch = Array.from(pending);
  pending.clear();

  const t0 = performance.now();
  let bailed = false;
  let processedInBatch = 0;
  for (let i = 0; i < batch.length; i++) {
    scanSubtree(batch[i]);
    processedInBatch++;
    if (performance.now() - t0 > BATCH_BUDGET_MS && i < batch.length - 1) {
      for (let j = i + 1; j < batch.length; j++) pending.add(batch[j]);
      scheduled = true;
      scheduleIdle(drain);
      bailed = true;
      break;
    }
  }
  const elapsed = performance.now() - t0;
  drainCount++;
  totalDrainMs += elapsed;
  if (elapsed > maxDrainMs) maxDrainMs = elapsed;
  overlay.update(totalScanned, totalHidden, elapsed);

  // Hard kill-switch: if any one drain or cumulative scan time blows our budget,
  // disable the scanner entirely and unhide everything. Surfaces the bug
  // instead of hanging the tab. Numbers are inlined into the message string
  // because Brave's extension error panel doesn't expand object args.
  if (elapsed > HARD_KILL_DRAIN_MS) {
    killed = true;
    observer.disconnect();
    pending.clear();
    unhideAll();
    console.warn(
      `[hide-em] DRAIN OVER ${HARD_KILL_DRAIN_MS}ms — scanner disabled. ` +
      JSON.stringify({
        elapsed: Math.round(elapsed),
        startSize,
        batchLength: batch.length,
        processedInBatch,
        totalScanned,
        totalHidden,
        findHideTargetCalls,
        findHideTargetSteps,
        mutationCallbackCount,
        mutationsObserved,
        ruleCount: compiled.ruleIndex.size,
      }),
    );
    return;
  }
  if (totalDrainMs > HARD_KILL_TOTAL_MS) {
    killed = true;
    observer.disconnect();
    pending.clear();
    unhideAll();
    console.warn(
      `[hide-em] CUMULATIVE SCAN OVER ${HARD_KILL_TOTAL_MS}ms — scanner disabled. ` +
      JSON.stringify({
        totalDrainMs: Math.round(totalDrainMs),
        drainCount,
        maxDrainMs: Math.round(maxDrainMs),
        maxPendingSize,
        totalScanned,
        totalHidden,
        findHideTargetCalls,
        findHideTargetSteps,
        mutationCallbackCount,
        mutationsObserved,
        ruleCount: compiled.ruleIndex.size,
      }),
    );
    return;
  }
  if (elapsed > SLOW_DRAIN_THRESHOLD_MS) {
    console.warn(
      `[hide-em] slow drain ` +
      JSON.stringify({
        elapsed: Math.round(elapsed),
        startSize,
        batchLength: batch.length,
        processedInBatch,
        pendingAfter: pending.size,
        totalScanned,
        totalHidden,
        drainCount,
      }),
    );
  }

  // scanSubtree decomposes large subtrees by queueing element children.
  // If that left work in `pending`, yield to the browser before continuing
  // — microtask chaining here would starve rendering on large DOMs (YouTube).
  if (!bailed && !scheduled && pending.size > 0) {
    scheduled = true;
    scheduleIdle(drain);
  }
}

function scheduleIdle(cb: () => void): void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(cb, { timeout: 100 });
  } else {
    setTimeout(cb, 0);
  }
}

function scanSubtree(root: Node): void {
  if (!settings?.enabled) return;
  if (processed.has(root)) return;

  if (root.nodeType === Node.TEXT_NODE) {
    scanTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (SKIP_TAGS.has(el.tagName)) return;
  if (!el.isConnected) return;
  // closest() checks self first, so this covers `el` having the class too.
  // Walking up once is cheaper than re-walking every descendant subtree.
  if (el.closest(`.${HIDDEN_CLASS}`)) {
    processed.add(root);
    return;
  }

  // Scan direct text-node children inline; queue element children for later drains.
  // Per-call work is O(direct children) instead of O(subtree), which is what makes
  // the BATCH_BUDGET_MS check in drain() actually constrain main-thread blocking.
  for (let child = el.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) {
      const data = (child as Text).data;
      if (data.length >= MIN_TEXT_LEN && data.trim()) {
        scanTextNode(child as Text);
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (SKIP_TAGS.has(childEl.tagName)) continue;
      if (childEl.classList.contains(HIDDEN_CLASS)) continue;
      if (processed.has(childEl)) continue;
      pending.add(childEl);
    }
  }
  processed.add(root);
}

function scanTextNode(node: Text): void {
  if (!compiled) return;
  if (processed.has(node)) return;
  processed.add(node);
  totalScanned++;

  const text = node.data;
  if (text.length < MIN_TEXT_LEN) return;
  // Skip very long text nodes — likely article body, JSON blob, or pre-formatted
  // content. testMulti does up to 8 normalize+regex passes, each O(n); a 50KB
  // text node would take 100s of ms per scan and we never want to filter on it.
  if (text.length > MAX_TEXT_LEN) return;

  const fields: Partial<Record<keyof RuleScope, string>> = {
    titles: text, channels: text, comments: text, descriptions: text,
  };
  const result = testMulti(compiled, fields);
  if (!result.matched) return;

  const target = findHideTarget(node.parentElement);
  if (!target) return;
  if (target.classList.contains(HIDDEN_CLASS)) return;

  hide(target);
  totalHidden++;

  if (settings?.debug) {
    console.debug('[hide-em] hid', target.tagName.toLowerCase(), {
      match: result.matchedText,
      ruleId: result.ruleId,
      text: text.slice(0, 80),
    });
  }
}

function findHideTarget(start: Element | null): Element | null {
  // Pure DOM-traversal path: no getBoundingClientRect, no layout reads.
  // The previous sized-block fallback (40x100px via getBoundingClientRect)
  // caused layout thrashing on large match counts — each rect read after a hide
  // forced a fresh layout. The tradeoff: text matches outside a semantic
  // card / ARIA role / custom-element renderer won't be hidden.
  findHideTargetCalls++;
  let el: Element | null = start;
  while (el && el !== document.body && el !== document.documentElement) {
    findHideTargetSteps++;
    const tag = el.tagName;

    if (SEMANTIC_CARD_TAGS.has(tag)) return el;

    const role = el.getAttribute('role');
    if (role === 'article' || role === 'listitem') return el;

    if (tag.includes('-') && (tag.endsWith('-RENDERER') || tag.endsWith('-CARD'))) {
      return el;
    }

    el = el.parentElement;
  }

  return null;
}

function hide(el: Element): void {
  el.classList.add(HIDDEN_CLASS);
  el.setAttribute(STATE_ATTR, 'hidden');
}

function unhideAll(): void {
  document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((el) => {
    el.classList.remove(HIDDEN_CLASS);
    el.removeAttribute(STATE_ATTR);
  });
}

function rescanAll(): void {
  rescanCount++;
  const now = performance.now();
  if (rescanCount > 1 && now - lastRescanAt < 1000) {
    console.warn(
      `[hide-em] rescanAll twice within 1s — storage churn? ` +
      JSON.stringify({ rescanCount, msSinceLast: Math.round(now - lastRescanAt) }),
    );
  }
  lastRescanAt = now;
  unhideAll();
  processed = new WeakSet();
  pending.clear();
  totalScanned = 0;
  totalHidden = 0;
  if (document.body) pending.add(document.body);
  if (initReady && !killed) schedule();
}

// --- Synchronous bootstrap at document_start ---
// 1) Inject hide stylesheet immediately so later classList.add takes effect with zero layout cost.
injectHideStyle();
// 2) Start observing immediately, BEFORE rules are loaded. Mutations queue into `pending`.
//    Observe documentElement (not body) because body may not exist yet at document_start.
const observer = new MutationObserver(handleMutations);
observer.observe(document.documentElement, { childList: true, subtree: true });
// 3) If body already exists at script load, queue it for the first drain.
if (document.body) pending.add(document.body);

async function init(): Promise<void> {
  const [rules, s] = await Promise.all([getRules(), getSettings()]);
  compiled = compile(rules);
  settings = s;

  if (settings.debug) overlay.show();

  window.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.altKey && e.key === 'D') overlay.toggle();
  });

  onRulesChanged((r) => {
    compiled = compile(r);
    rescanAll();
  });
  onSettingsChanged((s2) => {
    settings = s2;
    if (s2.debug) overlay.show(); else overlay.hide();
    rescanAll();
  });

  if (document.body) pending.add(document.body);

  initReady = true;
  schedule();
}

init().catch((e) => {
  console.debug('[hide-em] scanner init failed', e);
});

// --- Diagnostic console handle ---
// Inspect from DevTools console: `__heDebug.stats`. Manual control:
// `__heDebug.kill()` to disable, `__heDebug.unkill()` to re-enable, `__heDebug.unhideAll()` to clear hides.
(window as unknown as { __heDebug: unknown }).__heDebug = {
  get stats(): Record<string, unknown> {
    return {
      killed,
      initReady,
      scheduled,
      enabled: settings?.enabled ?? null,
      debug: settings?.debug ?? null,
      ruleCount: compiled?.ruleIndex.size ?? 0,
      drainCount,
      totalDrainMs: Math.round(totalDrainMs),
      maxDrainMs: Math.round(maxDrainMs),
      avgDrainMs: drainCount > 0 ? Math.round(totalDrainMs / drainCount) : 0,
      pendingSize: pending.size,
      maxPendingSize,
      totalScanned,
      totalHidden,
      findHideTargetCalls,
      findHideTargetSteps,
      avgFindHideTargetSteps: findHideTargetCalls > 0
        ? Math.round(findHideTargetSteps / findHideTargetCalls)
        : 0,
      rescanCount,
      mutationCallbackCount,
      mutationsObserved,
    };
  },
  kill(): void {
    killed = true;
    observer.disconnect();
    pending.clear();
    unhideAll();
    console.warn('[hide-em] scanner killed; observer disconnected; hides cleared');
  },
  unkill(): void {
    killed = false;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.body) pending.add(document.body);
    if (initReady) schedule();
    console.warn('[hide-em] scanner re-enabled');
  },
  unhideAll,
};
