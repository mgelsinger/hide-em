import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPageStatus, pauseTab } from './page-control-client.js';

type AsyncChromeMock = (...args: unknown[]) => Promise<unknown>;

function runtimeSendMessageMock() {
  return vi.mocked(chrome.runtime.sendMessage as unknown as AsyncChromeMock);
}

function tabSendMessageMock() {
  return vi.mocked(chrome.tabs.sendMessage as unknown as AsyncChromeMock);
}

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: vi.fn() },
    tabs: { sendMessage: vi.fn() },
  });
});

describe('page-control client', () => {
  it('returns confirmed temporary-control changes', async () => {
    runtimeSendMessageMock().mockResolvedValue({
      ok: true,
      resolution: { tabPaused: true, sitePause: null },
      message: 'This tab is paused.',
    });
    await expect(pauseTab('example.com', 1)).resolves.toMatchObject({
      resolution: { tabPaused: true },
      message: 'This tab is paused.',
    });
  });

  it('surfaces service-worker errors', async () => {
    runtimeSendMessageMock().mockResolvedValue({ ok: false, error: 'Session storage failed.' });
    await expect(pauseTab('example.com', 1)).rejects.toThrow('Session storage failed.');
  });

  it('rejects malformed successful service-worker responses', async () => {
    runtimeSendMessageMock().mockResolvedValue({
      ok: true,
      resolution: { tabPaused: 'yes', sitePause: null },
    });
    await expect(pauseTab('example.com', 1)).rejects.toThrow('invalid response');
  });

  it('returns scanner status from a content script', async () => {
    tabSendMessageMock().mockResolvedValue({
      available: true,
      hostname: 'example.com',
      state: 'active',
      hiddenCount: 3,
      tabPaused: false,
      sitePause: null,
      excludedBy: null,
    });
    await expect(getPageStatus(1, 'example.com')).resolves.toMatchObject({ available: true, hiddenCount: 3 });
  });

  it('returns a safe unavailable state for restricted pages and missing scripts', async () => {
    tabSendMessageMock().mockRejectedValue(new Error('Receiving end does not exist'));
    await expect(getPageStatus(1, 'example.com')).resolves.toMatchObject({
      available: false,
      hostname: 'example.com',
    });
  });
});
