import { applyConfigCommand } from '../shared/config-operations.js';
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

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isConfigCommand(message)) return false;
  void enqueue(() => handleCommand(message)).then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void enqueue(getOrMigrateConfig).catch((error) => {
    console.error('[hide-em] configuration migration failed', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  void enqueue(getOrMigrateConfig).catch((error) => {
    console.error('[hide-em] configuration initialization failed', error);
  });
});
