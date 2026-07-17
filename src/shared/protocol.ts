import type { BlockRule, RuleDraft, Settings, StoredConfig } from './types.js';

type MutationBase = { requestId: string };

export type ConfigCommand =
  | { type: 'config.get' }
  | ({ type: 'rule.add'; draft: RuleDraft } & MutationBase)
  | ({ type: 'rule.update'; rule: BlockRule } & MutationBase)
  | ({ type: 'rule.delete'; id: string } & MutationBase)
  | ({ type: 'rule.setEnabled'; id: string; enabled: boolean } & MutationBase)
  | ({ type: 'settings.update'; patch: Partial<Settings> } & MutationBase)
  | ({ type: 'exclusion.add'; input: string } & MutationBase)
  | ({ type: 'exclusion.delete'; id: string } & MutationBase)
  | ({ type: 'exclusion.setEnabled'; id: string; enabled: boolean } & MutationBase)
  | ({ type: 'import.apply'; data: unknown; mode: 'merge' | 'replace' } & MutationBase);

export type CommandResponse =
  | { ok: true; config: StoredConfig; message?: string }
  | { ok: false; error: string };

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRequestId(value: RecordLike): boolean {
  return typeof value['requestId'] === 'string' && value['requestId'].length > 0 && value['requestId'].length <= 200;
}

function hasStringId(value: RecordLike): boolean {
  return typeof value['id'] === 'string' && value['id'].length > 0;
}

export function isConfigCommand(value: unknown): value is ConfigCommand {
  if (!isRecord(value) || typeof value['type'] !== 'string') return false;
  if (value['type'] === 'config.get') return true;
  if (!hasRequestId(value)) return false;

  switch (value['type']) {
    case 'rule.add':
      return isRecord(value['draft']);
    case 'rule.update':
      return isRecord(value['rule']);
    case 'rule.delete':
    case 'exclusion.delete':
      return hasStringId(value);
    case 'rule.setEnabled':
    case 'exclusion.setEnabled':
      return hasStringId(value) && typeof value['enabled'] === 'boolean';
    case 'settings.update':
      return isRecord(value['patch']);
    case 'exclusion.add':
      return typeof value['input'] === 'string';
    case 'import.apply':
      return value['mode'] === 'merge' || value['mode'] === 'replace';
    default:
      return false;
  }
}
