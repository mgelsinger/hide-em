import { describe, expect, it } from 'vitest';
import {
  TEN_MINUTES_MS,
  clearSitePause,
  clearTabPause,
  createTemporaryControlState,
  isPageControlApply,
  isTemporaryControlCommand,
  normalizePageHostname,
  pruneExpiredPauses,
  resolveTemporaryControl,
  setSitePause,
  setTabPause,
  validateTemporaryControlState,
} from './page-control.js';

describe('temporary page controls', () => {
  it('normalizes web, local, and IP hostnames', () => {
    expect(normalizePageHostname(' Example.COM. ')).toBe('example.com');
    expect(normalizePageHostname('localhost')).toBe('localhost');
    expect(normalizePageHostname('127.0.0.1')).toBe('127.0.0.1');
  });

  it('sets, resolves, and clears a tab pause', () => {
    const paused = setTabPause(createTemporaryControlState(), 42);
    expect(resolveTemporaryControl(paused, 42, 'example.com').tabPaused).toBe(true);
    expect(resolveTemporaryControl(paused, 43, 'example.com').tabPaused).toBe(false);
    expect(clearTabPause(paused, 42).pausedTabs).toEqual([]);
  });

  it('sets a 10-minute site pause and prunes it at expiration', () => {
    const paused = setSitePause(createTemporaryControlState(), 'example.com', 'ten_minutes', 1_000);
    expect(paused.pausedSites[0].expiresAt).toBe(1_000 + TEN_MINUTES_MS);
    expect(pruneExpiredPauses(paused, 1_000 + TEN_MINUTES_MS - 1).changed).toBe(false);
    expect(pruneExpiredPauses(paused, 1_000 + TEN_MINUTES_MS)).toMatchObject({ changed: true, state: { pausedSites: [] } });
  });

  it('matches paused hostnames to their subdomains using boundary-safe matching', () => {
    const paused = setSitePause(createTemporaryControlState(), 'example.com', 'session', 1);
    expect(resolveTemporaryControl(paused, 1, 'chat.example.com').sitePause?.hostname).toBe('example.com');
    expect(resolveTemporaryControl(paused, 1, 'notexample.com').sitePause).toBeNull();
  });

  it('prefers the most specific matching pause', () => {
    let state = setSitePause(createTemporaryControlState(), 'example.com', 'session', 1);
    state = setSitePause(state, 'chat.example.com', 'session', 2);
    expect(resolveTemporaryControl(state, 1, 'room.chat.example.com').sitePause?.hostname).toBe('chat.example.com');
    expect(clearSitePause(state, 'chat.example.com').pausedSites.map((pause) => pause.hostname)).toEqual(['example.com']);
  });

  it('recovers a safe subset from malformed session state', () => {
    expect(validateTemporaryControlState({
      version: 1,
      pausedTabs: [1, 1, -2, 'bad'],
      pausedSites: [{ hostname: 'Example.com', createdAt: 1, expiresAt: null }, { hostname: 'bad host' }],
    })).toEqual({
      version: 1,
      pausedTabs: [1],
      pausedSites: [{ hostname: 'example.com', createdAt: 1, expiresAt: null }],
    });
  });

  it('validates temporary-control messages', () => {
    expect(isTemporaryControlCommand({ type: 'temporary.tab.set', hostname: 'example.com', tabId: 1 })).toBe(true);
    expect(isTemporaryControlCommand({ type: 'temporary.tab.set', hostname: 'example.com' })).toBe(false);
    expect(isTemporaryControlCommand({ type: 'temporary.site.set', hostname: 'example.com', duration: 'forever' })).toBe(false);
  });

  it('rejects malformed direct page-control messages', () => {
    expect(isPageControlApply({
      type: 'page.control.apply',
      resolution: { tabPaused: false, sitePause: null },
    })).toBe(true);
    expect(isPageControlApply({
      type: 'page.control.apply',
      resolution: { tabPaused: false, sitePause: { hostname: 'example.com', createdAt: 'now', expiresAt: null } },
    })).toBe(false);
  });
});
