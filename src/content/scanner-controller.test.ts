// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../shared/types.js';
import { HIDDEN_CLASS, ScannerController } from './scanner-controller.js';

let controller: ScannerController;

function matchingConfig() {
  const config = createDefaultConfig(1);
  config.rules.push({
    id: 'blocked', type: 'keyword', value: 'blocked', aliases: [], enabled: true,
    caseSensitive: false, wholeWord: false, createdAt: 1, updatedAt: 1,
  });
  return config;
}

async function drainScanner(): Promise<void> {
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
  document.documentElement.innerHTML = '<head></head><body></body>';
  controller = new ScannerController('example.com');
});

afterEach(() => {
  controller.destroy();
  vi.useRealTimers();
});

describe('scanner lifecycle controls', () => {
  it('reports and reveals the exact number of currently hidden cards', async () => {
    document.body.innerHTML = '<article>blocked one</article><article>allowed</article><li>blocked two</li>';
    controller.applyConfig(matchingConfig());
    await drainScanner();
    expect(controller.getStatus()).toMatchObject({ state: 'active', hiddenCount: 2 });
    controller.showAll();
    expect(document.querySelectorAll(`.${HIDDEN_CLASS}`)).toHaveLength(0);
  });

  it('does not double-count a hidden item nested inside another hidden card', () => {
    document.body.innerHTML = `<article class="${HIDDEN_CLASS}"><li class="${HIDDEN_CLASS}">blocked</li></article>`;
    expect(controller.getStatus().hiddenCount).toBe(1);
  });

  it('reveals content while paused and rescans when the tab resumes', async () => {
    document.body.innerHTML = '<article>blocked content</article>';
    controller.applyConfig(matchingConfig());
    await drainScanner();
    expect(controller.getStatus().hiddenCount).toBe(1);
    controller.applyTemporary({ tabPaused: true, sitePause: null });
    expect(controller.getStatus()).toMatchObject({ state: 'tab_paused', hiddenCount: 0 });
    controller.applyTemporary({ tabPaused: false, sitePause: null });
    await drainScanner();
    expect(controller.getStatus()).toMatchObject({ state: 'active', hiddenCount: 1 });
  });

  it('respects global settings and permanent exclusions before temporary state', () => {
    const disabled = matchingConfig();
    disabled.settings.enabled = false;
    controller.applyTemporary({ tabPaused: true, sitePause: null });
    controller.applyConfig(disabled);
    expect(controller.getStatus().state).toBe('global_disabled');
    const excluded = matchingConfig();
    excluded.excludedDomains.push({ id: 'site', hostname: 'example.com', enabled: true, createdAt: 1 });
    controller.applyConfig(excluded);
    expect(controller.getStatus().state).toBe('excluded');
  });

  it('automatically resumes after a timed site pause expires', async () => {
    document.body.innerHTML = '<article>blocked content</article>';
    const expiresAt = Date.now() + 60_000;
    controller.applyTemporary({
      tabPaused: false,
      sitePause: { hostname: 'example.com', createdAt: Date.now(), expiresAt },
    });
    controller.applyConfig(matchingConfig());
    expect(controller.getStatus().state).toBe('site_paused');
    await vi.advanceTimersByTimeAsync(60_000);
    await drainScanner();
    expect(controller.getStatus()).toMatchObject({ state: 'active', hiddenCount: 1 });
  });
});
