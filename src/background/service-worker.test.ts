import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEMPORARY_CONTROL_KEY } from '../shared/page-control.js';
import type { TemporaryControlCommand, TemporaryControlResponse } from '../shared/page-control.js';
import type { CommandResponse, ConfigCommand } from '../shared/protocol.js';
import { CONFIG_KEY, createDefaultConfig } from '../shared/types.js';

type ExtensionResponse = CommandResponse | TemporaryControlResponse;
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionResponse) => void,
) => boolean | undefined;

let localData: Record<string, unknown>;
let sessionData: Record<string, unknown>;
let messageListener: MessageListener;
let tabRemovedListener: (tabId: number) => void;
let failNextLocalWrite: boolean;
let openTabs: Array<{ id: number; url: string }>;
let sentTabMessages: Array<{ tabId: number; message: unknown }>;

function storageGet(data: Record<string, unknown>, keys: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  if (typeof keys === 'string') return { [keys]: data[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, data[key]]));
  if (keys && typeof keys === 'object') {
    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, data[key] ?? fallback]));
  }
  return { ...data };
}

async function dispatch<T extends ExtensionResponse>(
  command: ConfigCommand | TemporaryControlCommand,
  sender: chrome.runtime.MessageSender = {},
): Promise<T> {
  return new Promise((resolve) => {
    expect(messageListener(command, sender, (response) => resolve(response as T))).toBe(true);
  });
}

beforeEach(async () => {
  vi.resetModules();
  localData = {};
  sessionData = {};
  failNextLocalWrite = false;
  openTabs = [];
  sentTabMessages = [];
  const lifecycleListeners = { addListener: vi.fn() };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys) => storageGet(localData, keys)),
        set: vi.fn(async (values: Record<string, unknown>) => {
          if (failNextLocalWrite) {
            failNextLocalWrite = false;
            throw new Error('QUOTA_BYTES limit reached');
          }
          Object.assign(localData, values);
        }),
        remove: vi.fn(async (key: string) => { delete localData[key]; }),
      },
      session: {
        get: vi.fn(async (keys) => storageGet(sessionData, keys)),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(sessionData, values); }),
        remove: vi.fn(async (key: string) => { delete sessionData[key]; }),
      },
      sync: {
        get: vi.fn(async (defaults: Record<string, unknown>) => defaults),
      },
    },
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => { messageListener = listener; }),
      },
      onInstalled: lifecycleListeners,
      onStartup: lifecycleListeners,
    },
    tabs: {
      query: vi.fn(async () => openTabs),
      sendMessage: vi.fn(async (tabId: number, message: unknown) => {
        sentTabMessages.push({ tabId, message });
        return undefined;
      }),
      onRemoved: {
        addListener: vi.fn((listener: (tabId: number) => void) => { tabRemovedListener = listener; }),
      },
    },
  });
  await import('./service-worker.js');
});

describe('service worker storage serialization', () => {
  it('keeps both rapid rule additions', async () => {
    const first = dispatch<CommandResponse>({
      type: 'rule.add', requestId: 'first',
      draft: { type: 'keyword', value: 'one', aliases: [], caseSensitive: false, wholeWord: false },
    });
    const second = dispatch<CommandResponse>({
      type: 'rule.add', requestId: 'second',
      draft: { type: 'keyword', value: 'two', aliases: [], caseSensitive: false, wholeWord: false },
    });
    expect(await first).toMatchObject({ ok: true });
    const secondResponse = await second;
    expect(secondResponse).toMatchObject({ ok: true });
    if (!secondResponse.ok) return;
    expect(secondResponse.config.rules.map((rule) => rule.value)).toEqual(['one', 'two']);
  });

  it('returns a visible error and preserves the previous config when a write fails', async () => {
    const existing = createDefaultConfig(1);
    localData[CONFIG_KEY] = existing;
    failNextLocalWrite = true;
    const response = await dispatch<CommandResponse>({
      type: 'rule.add', requestId: 'failed',
      draft: { type: 'keyword', value: 'not saved', aliases: [], caseSensitive: false, wholeWord: false },
    });
    expect(response).toMatchObject({ ok: false, error: 'QUOTA_BYTES limit reached' });
    expect(localData[CONFIG_KEY]).toEqual(existing);
  });
});

describe('service worker temporary controls', () => {
  it('stores tab pauses in session memory and removes them when the tab closes', async () => {
    const paused = await dispatch<TemporaryControlResponse>({
      type: 'temporary.tab.set', hostname: 'example.com', tabId: 7,
    });
    expect(paused).toMatchObject({ ok: true, resolution: { tabPaused: true } });
    expect(sessionData[TEMPORARY_CONTROL_KEY]).toMatchObject({ pausedTabs: [7] });
    expect(sentTabMessages).toHaveLength(1);

    tabRemovedListener(7);
    const afterClose = await dispatch<TemporaryControlResponse>({
      type: 'temporary.get', hostname: 'example.com', tabId: 7,
    });
    expect(afterClose).toMatchObject({ ok: true, resolution: { tabPaused: false } });
  });

  it('broadcasts site pauses only to matching hostname boundaries', async () => {
    openTabs = [
      { id: 1, url: 'https://example.com/one' },
      { id: 2, url: 'https://chat.example.com/two' },
      { id: 3, url: 'https://notexample.com/three' },
    ];
    const response = await dispatch<TemporaryControlResponse>({
      type: 'temporary.site.set', hostname: 'example.com', duration: 'ten_minutes', tabId: 1,
    });
    expect(response).toMatchObject({ ok: true, resolution: { sitePause: { hostname: 'example.com' } } });
    expect(sentTabMessages.map((entry) => entry.tabId)).toEqual([1, 2]);
  });

  it('uses the sender tab when content scripts resolve their state', async () => {
    await dispatch<TemporaryControlResponse>({ type: 'temporary.tab.set', hostname: 'example.com', tabId: 9 });
    const response = await dispatch<TemporaryControlResponse>(
      { type: 'temporary.get', hostname: 'example.com' },
      { tab: { id: 9 } as chrome.tabs.Tab },
    );
    expect(response).toMatchObject({ ok: true, resolution: { tabPaused: true } });
  });
});
