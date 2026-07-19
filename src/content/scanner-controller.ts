import { compile, test } from '../engine/matcher.js';
import type { CompiledRuleset, MatchResult } from '../engine/matcher.js';
import { hostnameMatches } from '../shared/domains.js';
import type { PageScannerState, PageStatus, TemporaryResolution } from '../shared/page-control.js';
import type { StoredConfig } from '../shared/types.js';
import { DebugOverlay } from './debug-overlay.js';
import {
  collectBoundedText,
  findHideTarget,
  isInsideSkippedContent,
  isHideTargetElement,
} from './scanner-targets.js';

const STATE_ATTR = 'data-he-state';
export const HIDDEN_CLASS = '__he-hidden';
const STYLE_ID = '__he-style';
const OVERLAY_ID = 'he-debug-overlay';
const MIN_TEXT_LENGTH = 2;
const MAX_TEXT_LENGTH = 5000;
const BATCH_BUDGET_MS = 8;
const HARD_KILL_DRAIN_MS = 1000;
const SLOW_DRAIN_MS = 100;

const EMPTY_TEMPORARY: TemporaryResolution = { tabPaused: false, sitePause: null };

export class ScannerController {
  private config: StoredConfig | null = null;
  private temporary: TemporaryResolution = EMPTY_TEMPORARY;
  private compiled: CompiledRuleset = compile([]);
  private observer: MutationObserver | null = null;
  private processed = new WeakSet<Node>();
  private readonly pending = new Set<Node>();
  private readonly dirtyHiddenCards = new Set<Element>();
  private scheduled = false;
  private active = false;
  private killed = false;
  private totalScanned = 0;
  private totalHidden = 0;
  private drainCount = 0;
  private maxDrainMs = 0;
  private maxPendingSize = 0;
  private mutationCount = 0;
  private pauseTimer: number | null = null;
  private readonly overlay = new DebugOverlay();

  constructor(private readonly hostname = location.hostname) {}

  applyConfig(next: StoredConfig): void {
    const previousFingerprint = this.compiled.fingerprint;
    this.config = next;
    this.compiled = compile(next.rules);
    this.reconcile(previousFingerprint !== this.compiled.fingerprint);
  }

  applyTemporary(resolution: TemporaryResolution): void {
    const changed = resolution.tabPaused !== this.temporary.tabPaused
      || resolution.sitePause?.hostname !== this.temporary.sitePause?.hostname
      || resolution.sitePause?.expiresAt !== this.temporary.sitePause?.expiresAt;
    this.temporary = resolution;
    this.schedulePauseExpiration();
    if (changed) this.reconcile(false);
  }

  getStatus(): PageStatus {
    return {
      available: true,
      hostname: this.hostname,
      state: this.currentState(),
      hiddenCount: Array.from(document.querySelectorAll(`.${HIDDEN_CLASS}`)).filter(
        (element) => !element.parentElement?.closest(`.${HIDDEN_CLASS}`),
      ).length,
      tabPaused: this.temporary.tabPaused,
      sitePause: this.temporary.sitePause,
      excludedBy: this.excludedBy(),
    };
  }

  showAll(): void {
    this.unhideAll();
  }

  rescan(): void {
    if (this.currentState() === 'active') this.rescanAll();
  }

  toggleOverlay(): void {
    this.overlay.toggle();
  }

  kill(reason = 'Stopped manually.'): void {
    this.killed = true;
    this.stopScanner();
    console.warn(`[hide-em] scanner disabled for this page. ${reason}`);
  }

  unkill(): void {
    this.killed = false;
    this.reconcile(true);
  }

  destroy(): void {
    if (this.pauseTimer !== null) window.clearTimeout(this.pauseTimer);
    this.stopScanner();
  }

  getStats(): Record<string, unknown> {
    return {
      active: this.active,
      killed: this.killed,
      state: this.currentState(),
      excluded: this.excludedBy() !== null,
      enabled: this.config?.settings.enabled ?? null,
      ruleCount: this.compiled.ruleIndex.size,
      drainCount: this.drainCount,
      maxDrainMs: Math.round(this.maxDrainMs),
      pendingSize: this.pending.size,
      maxPendingSize: this.maxPendingSize,
      totalScanned: this.totalScanned,
      totalHidden: this.totalHidden,
      mutationCount: this.mutationCount,
    };
  }

  private excludedBy(): string | null {
    return this.config?.excludedDomains.find(
      (entry) => entry.enabled && hostnameMatches(this.hostname, entry.hostname),
    )?.hostname ?? null;
  }

  private currentState(): PageScannerState {
    if (!this.config) return 'loading';
    if (!this.config.settings.enabled) return 'global_disabled';
    if (this.excludedBy()) return 'excluded';
    if (this.temporary.tabPaused) return 'tab_paused';
    if (this.temporary.sitePause) return 'site_paused';
    if (this.killed) return 'safety_stopped';
    return 'active';
  }

  private reconcile(forceRescan: boolean): void {
    if (this.currentState() !== 'active') {
      this.stopScanner();
      return;
    }
    this.injectHideStyle();
    if (!this.observer) this.observer = new MutationObserver((records) => this.handleMutations(records));
    if (!this.active) {
      this.observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
      this.active = true;
      forceRescan = true;
    }
    if (this.config?.settings.debug) this.overlay.show(); else this.overlay.hide();
    if (forceRescan) this.rescanAll();
  }

  private schedulePauseExpiration(): void {
    if (this.pauseTimer !== null) window.clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    const expiresAt = this.temporary.sitePause?.expiresAt;
    if (expiresAt === null || expiresAt === undefined) return;
    const delay = Math.max(0, expiresAt - Date.now());
    this.pauseTimer = window.setTimeout(() => {
      this.pauseTimer = null;
      if (this.temporary.sitePause?.expiresAt === expiresAt) {
        this.temporary = { ...this.temporary, sitePause: null };
        this.reconcile(true);
      }
    }, delay);
  }

  private injectHideStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
    document.documentElement.appendChild(style);
  }

  private removeHideStyle(): void {
    document.getElementById(STYLE_ID)?.remove();
  }

  private extensionOwned(node: Node): boolean {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    return Boolean(element?.closest(`#${STYLE_ID}, #${OVERLAY_ID}`));
  }

  private shouldQueue(node: Node): boolean {
    if (this.extensionOwned(node)) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      return !node.parentElement || !isInsideSkippedContent(node.parentElement);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return !isInsideSkippedContent(node as Element);
  }

  private hiddenAncestor(node: Node): Element | null {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    return element?.closest(`.${HIDDEN_CLASS}`) ?? null;
  }

  private handleMutations(records: MutationRecord[]): void {
    if (!this.active || this.killed) return;
    this.mutationCount += records.length;
    for (const record of records) {
      if (this.extensionOwned(record.target)) continue;
      const hidden = this.hiddenAncestor(record.target);
      if (hidden) {
        this.dirtyHiddenCards.add(hidden);
        continue;
      }
      const element = record.target.nodeType === Node.ELEMENT_NODE
        ? record.target as Element
        : record.target.parentElement;
      const card = findHideTarget(element);
      if (card) {
        this.processed.delete(card);
        this.pending.add(card);
      }
      if (record.type === 'characterData') {
        this.processed.delete(record.target);
        if (this.shouldQueue(record.target)) this.pending.add(record.target);
      }
      for (const added of record.addedNodes) {
        const addedHidden = this.hiddenAncestor(added);
        if (addedHidden) {
          this.dirtyHiddenCards.add(addedHidden);
        } else if (this.shouldQueue(added)) {
          this.processed.delete(added);
          this.pending.add(added);
        }
      }
    }
    this.maxPendingSize = Math.max(this.maxPendingSize, this.pending.size);
    if (this.pending.size > 0 || this.dirtyHiddenCards.size > 0) this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || !this.active || this.killed) return;
    this.scheduled = true;
    const host = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (typeof host.requestIdleCallback === 'function') {
      host.requestIdleCallback(() => this.drain(), { timeout: 100 });
    } else {
      setTimeout(() => this.drain(), 0);
    }
  }

  private drain(): void {
    this.scheduled = false;
    if (!this.active || this.killed) return;
    const started = performance.now();
    this.reevaluateHiddenCards(started);
    const batch = Array.from(this.pending);
    this.pending.clear();
    for (let index = 0; index < batch.length; index += 1) {
      this.scanSubtree(batch[index]);
      if (performance.now() - started > BATCH_BUDGET_MS && index < batch.length - 1) {
        for (let remaining = index + 1; remaining < batch.length; remaining += 1) {
          this.pending.add(batch[remaining]);
        }
        break;
      }
    }
    const elapsed = performance.now() - started;
    this.drainCount += 1;
    this.maxDrainMs = Math.max(this.maxDrainMs, elapsed);
    if (this.config?.settings.debug) this.overlay.update(this.totalScanned, this.totalHidden, elapsed);
    if (elapsed > HARD_KILL_DRAIN_MS) {
      this.kill(`A scan took ${Math.round(elapsed)}ms.`);
      return;
    }
    if (elapsed > SLOW_DRAIN_MS && this.config?.settings.debug) {
      console.warn('[hide-em] slow scan', { elapsed: Math.round(elapsed), pending: this.pending.size });
    }
    if (this.pending.size > 0 || this.dirtyHiddenCards.size > 0) this.schedule();
  }

  private testText(text: string): MatchResult {
    this.totalScanned += 1;
    if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH || !text.trim()) return { matched: false };
    return test(this.compiled, text);
  }

  private scanSubtree(root: Node): void {
    if (!this.active || this.processed.has(root) || !root.isConnected) return;
    if (root.nodeType === Node.TEXT_NODE) {
      this.scanTextNode(root as Text);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const element = root as Element;
    if (isInsideSkippedContent(element) || element.closest(`.${HIDDEN_CLASS}`)) return;
    if (isHideTargetElement(element)) {
      const text = collectBoundedText(element, MAX_TEXT_LENGTH);
      const result = text === null ? { matched: false } as const : this.testText(text);
      if (result.matched) {
        this.hide(element, result, text ?? '');
        this.processed.add(root);
        return;
      }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        this.scanTextNode(child as Text);
      } else if (this.shouldQueue(child) && !this.processed.has(child)) {
        this.pending.add(child);
      }
    }
    this.processed.add(root);
  }

  private scanTextNode(node: Text): void {
    if (this.processed.has(node)) return;
    this.processed.add(node);
    const result = this.testText(node.data);
    if (!result.matched) return;
    const target = findHideTarget(node.parentElement);
    if (target && !target.classList.contains(HIDDEN_CLASS)) this.hide(target, result, node.data);
  }

  private hide(element: Element, result: Extract<MatchResult, { matched: true }>, text: string): void {
    element.classList.add(HIDDEN_CLASS);
    element.setAttribute(STATE_ATTR, 'hidden');
    this.totalHidden += 1;
    if (this.config?.settings.debug) {
      console.debug('[hide-em] hid content', {
        element: element.tagName.toLowerCase(),
        match: result.matchedText,
        ruleId: result.ruleId,
        text: text.slice(0, 100),
      });
    }
  }

  private reevaluateHiddenCards(started: number): void {
    for (const card of this.dirtyHiddenCards) {
      this.dirtyHiddenCards.delete(card);
      if (card.isConnected && card.classList.contains(HIDDEN_CLASS)) {
        const text = collectBoundedText(card, MAX_TEXT_LENGTH);
        if (text === null || !this.testText(text).matched) {
          this.unhide(card);
          this.processed.delete(card);
          this.pending.add(card);
        }
      }
      if (performance.now() - started > BATCH_BUDGET_MS) return;
    }
  }

  private unhide(element: Element): void {
    element.classList.remove(HIDDEN_CLASS);
    element.removeAttribute(STATE_ATTR);
  }

  private unhideAll(): void {
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => this.unhide(element));
  }

  private rescanAll(): void {
    this.unhideAll();
    this.processed = new WeakSet<Node>();
    this.pending.clear();
    this.dirtyHiddenCards.clear();
    this.totalScanned = 0;
    this.totalHidden = 0;
    if (document.body) this.pending.add(document.body);
    this.schedule();
  }

  private stopScanner(): void {
    this.active = false;
    this.observer?.disconnect();
    this.pending.clear();
    this.dirtyHiddenCards.clear();
    this.scheduled = false;
    this.unhideAll();
    this.removeHideStyle();
    this.overlay.hide();
  }
}
