import { CONFIG_KEY, CURRENT_SCHEMA_VERSION } from './types.js';
import type {
  BlockRule,
  ExportBundle,
  RuleDraft,
  Settings,
  StoredConfig,
} from './types.js';
import type { CommandResponse, ConfigCommand } from './protocol.js';
import { createId, validateConfig } from './validation.js';

async function sendCommand(command: ConfigCommand): Promise<{ config: StoredConfig; message?: string }> {
  let response: CommandResponse;
  try {
    response = await chrome.runtime.sendMessage(command) as CommandResponse;
  } catch (error) {
    throw new Error(`Could not reach hide-em storage: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response || !response.ok) {
    throw new Error(response && 'error' in response ? response.error : 'Storage returned an invalid response.');
  }
  return { config: response.config, message: response.message };
}

function requestId(): string {
  return createId();
}

export async function getConfig(): Promise<StoredConfig> {
  return (await sendCommand({ type: 'config.get' })).config;
}

export async function addRule(draft: RuleDraft): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'rule.add', requestId: requestId(), draft });
}

export async function updateRule(rule: BlockRule): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'rule.update', requestId: requestId(), rule });
}

export async function deleteRule(id: string): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'rule.delete', requestId: requestId(), id });
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'rule.setEnabled', requestId: requestId(), id, enabled });
}

export async function updateSettings(patch: Partial<Settings>): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'settings.update', requestId: requestId(), patch });
}

export async function addExcludedDomain(input: string): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'exclusion.add', requestId: requestId(), input });
}

export async function deleteExcludedDomain(id: string): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'exclusion.delete', requestId: requestId(), id });
}

export async function setExcludedDomainEnabled(id: string, enabled: boolean): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'exclusion.setEnabled', requestId: requestId(), id, enabled });
}

export async function applyImport(data: unknown, mode: 'merge' | 'replace' = 'merge'): Promise<{ config: StoredConfig; message?: string }> {
  return sendCommand({ type: 'import.apply', requestId: requestId(), data, mode });
}

export function createExportBundle(config: StoredConfig): ExportBundle {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    rules: config.rules,
    settings: config.settings,
    excludedDomains: config.excludedDomains,
  };
}

export function onConfigChanged(cb: (config: StoredConfig) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return;
    const raw = changes[CONFIG_KEY]?.newValue as unknown;
    if (raw === undefined) return;
    const result = validateConfig(raw);
    if (result.ok) cb(result.value);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
