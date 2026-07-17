import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_KEY, createDefaultConfig } from '../shared/types.js';
import type { CommandResponse, ConfigCommand } from '../shared/protocol.js';

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: CommandResponse) => void,
) => boolean | undefined;

let localData: Record<string, unknown>;
let messageListener: MessageListener;
let failNextWrite: boolean;

function storageGet(keys: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  if (typeof keys === 'string') return { [keys]: localData[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, localData[key]]));
  if (keys && typeof keys === 'object') {
    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, localData[key] ?? fallback]));
  }
  return { ...localData };
}

async function send(command: ConfigCommand): Promise<CommandResponse> {
  return new Promise((resolve) => {
    expect(messageListener(command, {}, resolve)).toBe(true);
  });
}

beforeEach(async () => {
  vi.resetModules();
  localData = {};
  failNextWrite = false;
  const listeners = { addListener: vi.fn() };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys) => storageGet(keys)),
        set: vi.fn(async (values: Record<string, unknown>) => {
          if (failNextWrite) {
            failNextWrite = false;
            throw new Error('QUOTA_BYTES limit reached');
          }
          Object.assign(localData, values);
        }),
      },
      sync: {
        get: vi.fn(async (defaults: Record<string, unknown>) => defaults),
      },
    },
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => { messageListener = listener; }),
      },
      onInstalled: listeners,
      onStartup: listeners,
    },
  });
  await import('./service-worker.js');
});

describe('service worker storage serialization', () => {
  it('keeps both rapid rule additions', async () => {
    const first = send({
      type: 'rule.add',
      requestId: 'first',
      draft: { type: 'keyword', value: 'one', aliases: [], caseSensitive: false, wholeWord: false },
    });
    const second = send({
      type: 'rule.add',
      requestId: 'second',
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
    failNextWrite = true;
    const response = await send({
      type: 'rule.add',
      requestId: 'failed',
      draft: { type: 'keyword', value: 'not saved', aliases: [], caseSensitive: false, wholeWord: false },
    });
    expect(response).toMatchObject({ ok: false, error: 'QUOTA_BYTES limit reached' });
    expect(localData[CONFIG_KEY]).toEqual(existing);
  });
});
