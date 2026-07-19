import { applyConfigCommand } from '../shared/config-operations.js';
import { hostnameMatches } from '../shared/domains.js';
import {
  TEMPORARY_CONTROL_KEY,
  clearSitePause,
  clearTabPause,
  isTemporaryControlCommand,
  normalizePageHostname,
  pruneExpiredPauses,
  resolveTemporaryControl,
  setSitePause,
  setTabPause,
  validateTemporaryControlState,
} from '../shared/page-control.js';
import type {
  TemporaryControlCommand,
  TemporaryControlResponse,
  TemporaryControlState,
} from '../shared/page-control.js';
import { isConfigCommand } from '../shared/protocol.js';
import type { CommandResponse, ConfigCommand } from '../shared/protocol.js';
import {
  CONFIG_BACKUP_KEY,
  CONFIG_KEY,
  DEFAULT_SETTINGS,
} from '../shared/types.js';
import type { StoredConfig } from '../shared/types.js';
import {
  migrateLegacyConfig,
  validateConfig,
} from '../shared/validation.js';

let commandQueue: Promise<void> = Promise.resolve();
const MAX_CONFIG_BYTES = 4_000_000;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = commandQueue.then(task, task);
  commandQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function persistAndVerify(config: StoredConfig): Promise<StoredConfig> {
  const size = new TextEncoder().encode(JSON.stringify(config)).byteLength;
  if (size > MAX_CONFIG_BYTES) {
    throw new Error('The configuration is too large to save safely. Remove some rules or aliases and try again.');
  }
  const previous = await chrome.storage.local.get(CONFIG_KEY);
  const previousResult = validateConfig(previous[CONFIG_KEY]);
  await chrome.storage.local.set({
    [CONFIG_KEY]: config,
    ...(previousResult.ok ? { [CONFIG_BACKUP_KEY]: previousResult.value } : {}),
  });
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const result = validateConfig(stored[CONFIG_KEY]);
  if (!result.ok) throw new Error(`Saved configuration could not be verified: ${result.errors.join(' ')}`);
  if (JSON.stringify(result.value) !== JSON.stringify(config)) {
    throw new Error('Saved configuration did not match the requested change.');
  }
  return result.value;
}

async function getOrMigrateConfig(): Promise<StoredConfig> {
  const local = await chrome.storage.local.get(CONFIG_KEY);
  if (local[CONFIG_KEY] !== undefined) {
    const result = validateConfig(local[CONFIG_KEY]);
    if (result.ok) return result.value;

    const backup = await chrome.storage.local.get(CONFIG_BACKUP_KEY);
    const backupResult = validateConfig(backup[CONFIG_BACKUP_KEY]);
    if (backupResult.ok) {
      console.warn('[hide-em] restored configuration from the local backup');
      await chrome.storage.local.set({ [CONFIG_KEY]: backupResult.value });
      return backupResult.value;
    }
    throw new Error(`Stored configuration is invalid: ${result.errors.join(' ')}`);
  }

  let legacy: Record<string, unknown>;
  try {
    legacy = await chrome.storage.sync.get({ rules: [], settings: DEFAULT_SETTINGS });
  } catch (error) {
    console.warn('[hide-em] legacy sync storage was unavailable; starting with local defaults', error);
    legacy = { rules: [], settings: DEFAULT_SETTINGS };
  }
  const migration = migrateLegacyConfig(legacy['rules'], legacy['settings']);
  if (!migration.ok) throw new Error(`Legacy data could not be migrated: ${migration.errors.join(' ')}`);
  if (migration.warnings.length > 0) console.warn('[hide-em] migration warnings', migration.warnings);
  return persistAndVerify(migration.value);
}

async function handleCommand(command: ConfigCommand): Promise<CommandResponse> {
  try {
    const current = await getOrMigrateConfig();
    if (command.type === 'config.get') return { ok: true, config: current };
    const result = applyConfigCommand(current, command);
    const saved = result.config === current ? current : await persistAndVerify(result.config);
    return { ok: true, config: saved, message: result.message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function temporaryStorageArea(): chrome.storage.StorageArea {
  return typeof chrome.storage.session === 'undefined' ? chrome.storage.local : chrome.storage.session;
}

async function readTemporaryState(): Promise<TemporaryControlState> {
  const area = temporaryStorageArea();
  const stored = await area.get(TEMPORARY_CONTROL_KEY);
  const state = validateTemporaryControlState(stored[TEMPORARY_CONTROL_KEY]);
  const pruned = pruneExpiredPauses(state);
  if (pruned.changed) await area.set({ [TEMPORARY_CONTROL_KEY]: pruned.state });
  return pruned.state;
}

async function writeTemporaryState(state: TemporaryControlState): Promise<void> {
  await temporaryStorageArea().set({ [TEMPORARY_CONTROL_KEY]: state });
}

async function refreshTab(tabId: number, resolution: ReturnType<typeof resolveTemporaryControl>): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'page.control.apply', resolution });
  } catch {
    // Restricted, discarded, or not-yet-loaded tabs will resolve state when their content script starts.
  }
}

async function refreshHostname(hostname: string, state: TemporaryControlState): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined || !tab.url) return;
    try {
      const candidate = new URL(tab.url).hostname;
      if (hostnameMatches(candidate, hostname)) {
        await refreshTab(tab.id, resolveTemporaryControl(state, tab.id, candidate));
      }
    } catch {
      return;
    }
  }));
}

async function handleTemporaryCommand(
  command: TemporaryControlCommand,
  sender: chrome.runtime.MessageSender,
): Promise<TemporaryControlResponse> {
  try {
    const hostname = normalizePageHostname(command.hostname);
    const tabId = 'tabId' in command && command.tabId !== undefined ? command.tabId : sender.tab?.id;
    let state = await readTemporaryState();
    let message: string | undefined;

    switch (command.type) {
      case 'temporary.get':
        break;
      case 'temporary.tab.set':
        state = setTabPause(state, command.tabId);
        await writeTemporaryState(state);
        await refreshTab(command.tabId, resolveTemporaryControl(state, command.tabId, hostname));
        message = 'This tab is paused.';
        break;
      case 'temporary.tab.clear':
        state = clearTabPause(state, command.tabId);
        await writeTemporaryState(state);
        await refreshTab(command.tabId, resolveTemporaryControl(state, command.tabId, hostname));
        message = 'This tab is active again.';
        break;
      case 'temporary.site.set':
        state = setSitePause(state, hostname, command.duration);
        await writeTemporaryState(state);
        await refreshHostname(hostname, state);
        message = command.duration === 'ten_minutes'
          ? `${hostname} is paused for 10 minutes.`
          : `${hostname} is paused until the browser restarts.`;
        break;
      case 'temporary.site.clear':
        state = clearSitePause(state, hostname);
        await writeTemporaryState(state);
        await refreshHostname(hostname, state);
        message = `${hostname} is active again.`;
        break;
    }

    return { ok: true, resolution: resolveTemporaryControl(state, tabId, hostname), message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function clearTemporaryFallback(): Promise<void> {
  if (typeof chrome.storage.session === 'undefined') {
    await chrome.storage.local.remove(TEMPORARY_CONTROL_KEY);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isConfigCommand(message)) {
    void enqueue(() => handleCommand(message)).then(sendResponse);
    return true;
  }
  if (isTemporaryControlCommand(message)) {
    void enqueue(() => handleTemporaryCommand(message, sender)).then(sendResponse);
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    const state = await readTemporaryState();
    const next = clearTabPause(state, tabId);
    if (next !== state) await writeTemporaryState(next);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void enqueue(async () => {
    await clearTemporaryFallback();
    return getOrMigrateConfig();
  }).catch((error) => {
    console.error('[hide-em] configuration migration failed', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  void enqueue(async () => {
    await clearTemporaryFallback();
    return getOrMigrateConfig();
  }).catch((error) => {
    console.error('[hide-em] configuration initialization failed', error);
  });
});
