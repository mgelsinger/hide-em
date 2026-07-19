import type {
  PopupPageStatus,
  TemporaryControlCommand,
  TemporaryResolution,
} from './page-control.js';
import { isPageStatus, isTemporaryResolution } from './page-control.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sendTemporaryCommand(command: TemporaryControlCommand): Promise<{ resolution: TemporaryResolution; message?: string }> {
  let response: unknown;
  try {
    response = await chrome.runtime.sendMessage(command);
  } catch (error) {
    throw new Error(`Could not update temporary controls: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(response)) throw new Error('Temporary controls returned an invalid response.');
  if (response['ok'] !== true) {
    throw new Error(typeof response['error'] === 'string'
      ? response['error']
      : 'Temporary controls returned an invalid response.');
  }
  if (!isTemporaryResolution(response['resolution'])) {
    throw new Error('Temporary controls returned an invalid response.');
  }
  return {
    resolution: response['resolution'],
    ...(typeof response['message'] === 'string' ? { message: response['message'] } : {}),
  };
}

export function getTemporaryControl(hostname: string, tabId?: number) {
  return sendTemporaryCommand({ type: 'temporary.get', hostname, ...(tabId === undefined ? {} : { tabId }) });
}

export function pauseTab(hostname: string, tabId: number) {
  return sendTemporaryCommand({ type: 'temporary.tab.set', hostname, tabId });
}

export function resumeTab(hostname: string, tabId: number) {
  return sendTemporaryCommand({ type: 'temporary.tab.clear', hostname, tabId });
}

export function pauseSite(hostname: string, duration: 'ten_minutes' | 'session', tabId?: number) {
  return sendTemporaryCommand({ type: 'temporary.site.set', hostname, duration, ...(tabId === undefined ? {} : { tabId }) });
}

export function resumeSite(hostname: string, tabId?: number) {
  return sendTemporaryCommand({ type: 'temporary.site.clear', hostname, ...(tabId === undefined ? {} : { tabId }) });
}

export async function getPageStatus(tabId: number, hostname: string): Promise<PopupPageStatus> {
  try {
    const response: unknown = await chrome.tabs.sendMessage(tabId, { type: 'page.status.get' });
    if (!isPageStatus(response)) throw new Error('The page scanner returned an invalid response.');
    return response;
  } catch {
    return {
      available: false,
      hostname,
      reason: 'hide-em is unavailable on this browser page. Try refreshing a normal web page.',
    };
  }
}
