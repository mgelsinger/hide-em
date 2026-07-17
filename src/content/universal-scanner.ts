import { compile, test } from '../engine/matcher.js';
import type { CompiledRuleset, MatchResult } from '../engine/matcher.js';
import { isHostnameExcluded } from '../shared/domains.js';
import { getConfig, onConfigChanged } from '../shared/storage.js';
import type { StoredConfig } from '../shared/types.js';
import { DebugOverlay } from './debug-overlay.js';
import {
  collectBoundedText,
  findHideTarget,
  isInsideSkippedContent,
  isHideTargetElement,
} from './scanner-targets.js';

const STATE_ATTR = 'data-he-state';
const HIDDEN_CLASS = '__he-hidden';
const STYLE_ID = '__he-style';
const OVERLAY_ID = 'he-debug-overlay';
const MIN_TEXT_LENGTH = 2;
const MAX_TEXT_LENGTH = 5000;
const BATCH_BUDGET_MS = 8;
const HARD_KILL_DRAIN_MS = 1000;
const SLOW_DRAIN_MS = 100;

let config: StoredConfig | null = null;
let compiled: CompiledRuleset = compile([]);
let observer: MutationObserver | null = null;
let processed = new WeakSet<Node>();
const pending = new Set<Node>();
const dirtyHiddenCards = new Set<Element>();
let scheduled = false;
let active = false;
let killed = false;
let totalScanned = 0;
let totalHidden = 0;
let drainCount = 0;
let maxDrainMs = 0;
let maxPendingSize = 0;
let mutationCount = 0;
const overlay = new DebugOverlay();

function injectHideStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
  document.documentElement.appendChild(style);
}

function removeHideStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
}

function extensionOwned(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest(`#${STYLE_ID}, #${OVERLAY_ID}`));
}

function shouldQueue(node: Node): boolean {
  if (extensionOwned(node)) return false;
  if (node.nodeType === Node.TEXT_NODE) {
    return !node.parentElement || !isInsideSkippedContent(node.parentElement);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  if (isInsideSkippedContent(element)) return false;
  return true;
}

function hiddenAncestor(node: Node): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest(`.${HIDDEN_CLASS}`) ?? null;
}

function mutationCard(node: Node): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return findHideTarget(element);
}

function handleMutations(records: MutationRecord[]): void {
  if (!active || killed) return;
  mutationCount += records.length;

  for (const record of records) {
    if (extensionOwned(record.target)) continue;

    const hidden = hiddenAncestor(record.target);
    if (hidden) {
      dirtyHiddenCards.add(hidden);
      continue;
    }

    const card = mutationCard(record.target);
    if (card) {
      processed.delete(card);
      pending.add(card);
    }

    if (record.type === 'characterData') {
      processed.delete(record.target);
      if (shouldQueue(record.target)) pending.add(record.target);
    }

    for (const added of record.addedNodes) {
      const addedHidden = hiddenAncestor(added);
      if (addedHidden) {
        dirtyHiddenCards.add(addedHidden);
      } else if (shouldQueue(added)) {
        processed.delete(added);
        pending.add(added);
      }
    }
  }

  maxPendingSize = Math.max(maxPendingSize, pending.size);
  if (pending.size > 0 || dirtyHiddenCards.size > 0) schedule();
}

function schedule(): void {
  if (scheduled || !active || killed) return;
  scheduled = true;
  scheduleIdle(drain);
}

function scheduleIdle(callback: () => void): void {
  const host = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (typeof host.requestIdleCallback === 'function') {
    host.requestIdleCallback(callback, { timeout: 100 });
  } else {
    setTimeout(callback, 0);
  }
}

function drain(): void {
  scheduled = false;
  if (!active || killed) return;

  const started = performance.now();
  reevaluateHiddenCards(started);
  const batch = Array.from(pending);
  pending.clear();

  for (let index = 0; index < batch.length; index += 1) {
    scanSubtree(batch[index]);
    const elapsed = performance.now() - started;
    if (elapsed > BATCH_BUDGET_MS && index < batch.length - 1) {
      for (let remaining = index + 1; remaining < batch.length; remaining += 1) {
        pending.add(batch[remaining]);
      }
      break;
    }
  }

  const elapsed = performance.now() - started;
  drainCount += 1;
  maxDrainMs = Math.max(maxDrainMs, elapsed);
  if (config?.settings.debug) overlay.update(totalScanned, totalHidden, elapsed);

  if (elapsed > HARD_KILL_DRAIN_MS) {
    killScanner(`A scan took ${Math.round(elapsed)}ms.`);
    return;
  }
  if (elapsed > SLOW_DRAIN_MS && config?.settings.debug) {
    console.warn('[hide-em] slow scan', { elapsed: Math.round(elapsed), pending: pending.size });
  }

  if (pending.size > 0 || dirtyHiddenCards.size > 0) schedule();
}

function testText(text: string): MatchResult {
  totalScanned += 1;
  if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH || !text.trim()) return { matched: false };
  return test(compiled, text);
}

function scanSubtree(root: Node): void {
  if (!active || processed.has(root) || !root.isConnected) return;

  if (root.nodeType === Node.TEXT_NODE) {
    scanTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const element = root as Element;
  if (isInsideSkippedContent(element)) return;
  if (element.closest(`.${HIDDEN_CLASS}`)) return;

  if (isHideTargetElement(element)) {
    const text = collectBoundedText(element, MAX_TEXT_LENGTH);
    const result = text === null ? { matched: false } as const : testText(text);
    if (result.matched) {
      hide(element, result, text ?? '');
      processed.add(root);
      return;
    }
  }

  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) {
      scanTextNode(child as Text);
    } else if (shouldQueue(child) && !processed.has(child)) {
      pending.add(child);
    }
  }
  processed.add(root);
}

function scanTextNode(node: Text): void {
  if (processed.has(node)) return;
  processed.add(node);
  const result = testText(node.data);
  if (!result.matched) return;
  const target = findHideTarget(node.parentElement);
  if (target && !target.classList.contains(HIDDEN_CLASS)) hide(target, result, node.data);
}

function hide(element: Element, result: Extract<MatchResult, { matched: true }>, text: string): void {
  element.classList.add(HIDDEN_CLASS);
  element.setAttribute(STATE_ATTR, 'hidden');
  totalHidden += 1;
  if (config?.settings.debug) {
    console.debug('[hide-em] hid content', {
      element: element.tagName.toLowerCase(),
      match: result.matchedText,
      ruleId: result.ruleId,
      text: text.slice(0, 100),
    });
  }
}

function reevaluateHiddenCards(started: number): void {
  for (const card of dirtyHiddenCards) {
    dirtyHiddenCards.delete(card);
    if (card.isConnected && card.classList.contains(HIDDEN_CLASS)) {
      const text = collectBoundedText(card, MAX_TEXT_LENGTH);
      if (text === null || !testText(text).matched) {
        unhide(card);
        processed.delete(card);
        pending.add(card);
      }
    }
    if (performance.now() - started > BATCH_BUDGET_MS) return;
  }
}

function unhide(element: Element): void {
  element.classList.remove(HIDDEN_CLASS);
  element.removeAttribute(STATE_ATTR);
}

function unhideAll(): void {
  document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(unhide);
}

function rescanAll(): void {
  unhideAll();
  processed = new WeakSet<Node>();
  pending.clear();
  dirtyHiddenCards.clear();
  totalScanned = 0;
  totalHidden = 0;
  if (document.body) pending.add(document.body);
  schedule();
}

function startScanner(): void {
  if (killed) return;
  injectHideStyle();
  if (!observer) observer = new MutationObserver(handleMutations);
  if (!active) {
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    active = true;
  }
  if (config?.settings.debug) overlay.show(); else overlay.hide();
  rescanAll();
}

function stopScanner(): void {
  active = false;
  observer?.disconnect();
  pending.clear();
  dirtyHiddenCards.clear();
  scheduled = false;
  unhideAll();
  removeHideStyle();
  overlay.hide();
}

function killScanner(reason: string): void {
  killed = true;
  stopScanner();
  console.warn(`[hide-em] scanner disabled for this page. ${reason}`);
}

function applyConfig(next: StoredConfig): void {
  config = next;
  compiled = compile(next.rules);
  const excluded = isHostnameExcluded(location.hostname, next.excludedDomains);
  if (next.settings.enabled && !excluded) startScanner();
  else stopScanner();
}

window.addEventListener('keydown', (event) => {
  if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'd') overlay.toggle();
});

async function init(): Promise<void> {
  applyConfig(await getConfig());
  onConfigChanged(applyConfig);
}

void init().catch((reason: unknown) => {
  stopScanner();
  console.warn('[hide-em] scanner could not start', reason);
});

(window as unknown as { __heDebug: unknown }).__heDebug = {
  get stats(): Record<string, unknown> {
    return {
      active,
      killed,
      excluded: config ? isHostnameExcluded(location.hostname, config.excludedDomains) : null,
      enabled: config?.settings.enabled ?? null,
      ruleCount: compiled.ruleIndex.size,
      drainCount,
      maxDrainMs: Math.round(maxDrainMs),
      pendingSize: pending.size,
      maxPendingSize,
      totalScanned,
      totalHidden,
      mutationCount,
    };
  },
  kill(): void { killScanner('Stopped manually.'); },
  unkill(): void {
    killed = false;
    if (config) applyConfig(config);
  },
  unhideAll,
};
