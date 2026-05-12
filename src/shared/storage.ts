import type { BlockRule } from '../engine/matcher.js';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from './types.js';
import type { Settings, StorageLocal } from './types.js';

export async function getRules(): Promise<BlockRule[]> {
  const result = await chrome.storage.sync.get({ rules: [] });
  return (result['rules'] as BlockRule[]) ?? [];
}

export async function setRules(rules: BlockRule[]): Promise<void> {
  await chrome.storage.sync.set({ rules, schemaVersion: SCHEMA_VERSION });
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.sync.get({ settings: DEFAULT_SETTINGS });
  const stored = result['settings'] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    perPlatformEnabled: {
      ...DEFAULT_SETTINGS.perPlatformEnabled,
      ...stored?.perPlatformEnabled,
    },
  };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

export function onRulesChanged(cb: (rules: BlockRule[]) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if ('rules' in changes) {
      cb((changes['rules']?.newValue as BlockRule[]) ?? []);
    }
  };
  chrome.storage.sync.onChanged.addListener(listener);
  return () => chrome.storage.sync.onChanged.removeListener(listener);
}

export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if ('settings' in changes && changes['settings']?.newValue) {
      const stored = changes['settings'].newValue as Partial<Settings>;
      cb({ ...DEFAULT_SETTINGS, ...stored, perPlatformEnabled: { ...DEFAULT_SETTINGS.perPlatformEnabled, ...stored.perPlatformEnabled } });
    }
  };
  chrome.storage.sync.onChanged.addListener(listener);
  return () => chrome.storage.sync.onChanged.removeListener(listener);
}

export async function getHits(): Promise<Record<string, number>> {
  const result = await chrome.storage.local.get({ hits: {} });
  return (result['hits'] as Record<string, number>) ?? {};
}

export async function incrementHit(ruleId: string): Promise<void> {
  const hits = await getHits();
  hits[ruleId] = (hits[ruleId] ?? 0) + 1;
  await chrome.storage.local.set({ hits });
}

export async function getLocalData(): Promise<StorageLocal> {
  const result = await chrome.storage.local.get({
    hits: {},
    overrides: [],
    lastImport: null,
  });
  return {
    hits: (result['hits'] as Record<string, number>) ?? {},
    overrides: (result['overrides'] as StorageLocal['overrides']) ?? [],
    lastImport: (result['lastImport'] as StorageLocal['lastImport']) ?? null,
  };
}
