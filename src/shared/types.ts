export type RuleType = 'keyword' | 'creator' | 'phrase' | 'regex';

export type BlockRule = {
  id: string;
  type: RuleType;
  value: string;
  aliases: string[];
  enabled: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  createdAt: number;
  updatedAt: number;
};

export type RuleDraft = {
  type: RuleType;
  value: string;
  aliases: string[];
  caseSensitive: boolean;
  wholeWord: boolean;
};

export type Settings = {
  enabled: boolean;
  debug: boolean;
};

export type ExcludedDomain = {
  id: string;
  hostname: string;
  enabled: boolean;
  createdAt: number;
};

export type StoredConfig = {
  schemaVersion: 2;
  rules: BlockRule[];
  settings: Settings;
  excludedDomains: ExcludedDomain[];
  updatedAt: number;
  processedRequestIds: string[];
};

export type ExportBundle = {
  schemaVersion: 2;
  exportedAt: number;
  rules: BlockRule[];
  settings: Settings;
  excludedDomains: ExcludedDomain[];
};

export const CURRENT_SCHEMA_VERSION = 2 as const;
export const CONFIG_KEY = 'configV2';
export const CONFIG_BACKUP_KEY = 'configV2Backup';
export const MAX_PROCESSED_REQUEST_IDS = 100;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  debug: false,
};

export function createDefaultConfig(now = Date.now()): StoredConfig {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rules: [],
    settings: { ...DEFAULT_SETTINGS },
    excludedDomains: [],
    updatedAt: now,
    processedRequestIds: [],
  };
}
