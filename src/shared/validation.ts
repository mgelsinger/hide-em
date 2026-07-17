import { normalizeHostnameInput } from './domains.js';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  createDefaultConfig,
} from './types.js';
import type {
  BlockRule,
  ExcludedDomain,
  ExportBundle,
  RuleDraft,
  RuleType,
  Settings,
  StoredConfig,
} from './types.js';

const RULE_TYPES = new Set<RuleType>(['keyword', 'creator', 'phrase', 'regex']);
const MAX_RULE_VALUE_LENGTH = 500;
const MAX_REGEX_LENGTH = 200;
const MAX_ALIASES = 50;
const MAX_ALIAS_LENGTH = 200;
const QUANTIFIER = String.raw`(?:[+*]|\{\d+(?:,\d*)?\})`;
const NESTED_QUANTIFIER_RE = new RegExp(String.raw`\([^()]*${QUANTIFIER}[^()]*\)\s*${QUANTIFIER}`);
const QUANTIFIED_ALTERNATION_RE = new RegExp(String.raw`\([^()]*\|[^()]*\)\s*${QUANTIFIER}`);
const REPEATED_WILDCARD_RE = /\.\*[^{|)]*\.\*/;

type RecordLike = Record<string, unknown>;

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `he-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function validateRegexPattern(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_LENGTH) return `Regular expressions are limited to ${MAX_REGEX_LENGTH} characters.`;
  if (NESTED_QUANTIFIER_RE.test(pattern) || QUANTIFIED_ALTERNATION_RE.test(pattern) || REPEATED_WILDCARD_RE.test(pattern)) {
    return 'This expression contains a potentially unsafe repetition and is not supported.';
  }
  try {
    new RegExp(pattern, 'u');
    return null;
  } catch {
    return 'Invalid regular expression.';
  }
}

export function validateRuleDraft(input: unknown): ValidationResult<RuleDraft> {
  if (!isRecord(input)) return { ok: false, errors: ['Rule must be an object.'] };

  const type = RULE_TYPES.has(input['type'] as RuleType) ? input['type'] as RuleType : 'keyword';
  const value = stringValue(input['value']).trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!value) errors.push('Value is required.');
  if (value.length > MAX_RULE_VALUE_LENGTH) errors.push(`Values are limited to ${MAX_RULE_VALUE_LENGTH} characters.`);
  if (type === 'regex') {
    const regexError = validateRegexPattern(value);
    if (regexError) errors.push(regexError);
  }

  const rawAliases = Array.isArray(input['aliases']) ? input['aliases'] : [];
  const aliases = rawAliases
    .filter((alias): alias is string => typeof alias === 'string')
    .map((alias) => alias.trim())
    .filter(Boolean);
  if (aliases.length > MAX_ALIASES) errors.push(`Rules are limited to ${MAX_ALIASES} aliases.`);
  if (aliases.some((alias) => alias.length > MAX_ALIAS_LENGTH)) {
    errors.push(`Aliases are limited to ${MAX_ALIAS_LENGTH} characters.`);
  }
  if (type === 'regex') {
    for (const alias of aliases) {
      const regexError = validateRegexPattern(alias);
      if (regexError) errors.push(`Regex alias "${alias}": ${regexError}`);
    }
  }
  if (rawAliases.length !== aliases.length) warnings.push('Empty or invalid aliases were removed.');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      type,
      value,
      aliases: Array.from(new Set(aliases)),
      caseSensitive: booleanValue(input['caseSensitive'], false),
      wholeWord: type === 'regex' ? false : booleanValue(input['wholeWord'], type === 'creator'),
    },
    warnings,
  };
}

export function validateRule(input: unknown, now = Date.now()): ValidationResult<BlockRule> {
  if (!isRecord(input)) return { ok: false, errors: ['Rule must be an object.'] };
  const draft = validateRuleDraft(input);
  if (!draft.ok) return draft;
  return {
    ok: true,
    value: {
      id: stringValue(input['id']).trim() || createId(),
      ...draft.value,
      enabled: booleanValue(input['enabled'], true),
      createdAt: numberValue(input['createdAt'], now),
      updatedAt: numberValue(input['updatedAt'], now),
    },
    warnings: draft.warnings,
  };
}

export function ruleSignature(rule: Pick<BlockRule, 'type' | 'value' | 'aliases' | 'caseSensitive' | 'wholeWord'>): string {
  const preservePatternCase = rule.type === 'regex' || rule.caseSensitive;
  const normalizedValue = preservePatternCase ? rule.value.trim() : rule.value.trim().toLocaleLowerCase();
  const aliases = rule.aliases
    .map((alias) => preservePatternCase ? alias : alias.toLocaleLowerCase())
    .sort();
  return JSON.stringify([rule.type, normalizedValue, aliases, rule.caseSensitive, rule.wholeWord]);
}

export function validateSettings(input: unknown): Settings {
  if (!isRecord(input)) return { ...DEFAULT_SETTINGS };
  return {
    enabled: booleanValue(input['enabled'], DEFAULT_SETTINGS.enabled),
    debug: booleanValue(input['debug'], DEFAULT_SETTINGS.debug),
  };
}

export function validateExcludedDomain(input: unknown, now = Date.now()): ValidationResult<ExcludedDomain> {
  if (!isRecord(input)) return { ok: false, errors: ['Excluded domain must be an object.'] };
  try {
    return {
      ok: true,
      value: {
        id: stringValue(input['id']).trim() || createId(),
        hostname: normalizeHostnameInput(
          typeof input['hostname'] === 'string' ? input['hostname'] : stringValue(input['url']),
        ),
        enabled: booleanValue(input['enabled'], true),
        createdAt: numberValue(input['createdAt'], now),
      },
      warnings: [],
    };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function validateConfig(input: unknown): ValidationResult<StoredConfig> {
  if (!isRecord(input) || input['schemaVersion'] !== CURRENT_SCHEMA_VERSION) {
    return { ok: false, errors: ['Unsupported or missing configuration schema.'] };
  }
  if (!Array.isArray(input['rules']) || !Array.isArray(input['excludedDomains'])) {
    return { ok: false, errors: ['Configuration lists are missing or invalid.'] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const rules: BlockRule[] = [];
  const ids = new Set<string>();
  for (const rawRule of input['rules']) {
    const result = validateRule(rawRule);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    if (ids.has(result.value.id)) {
      errors.push(`Configuration contains duplicate rule id "${result.value.id}".`);
      continue;
    }
    ids.add(result.value.id);
    rules.push(result.value);
    warnings.push(...result.warnings);
  }

  const excludedDomains: ExcludedDomain[] = [];
  const hostnames = new Set<string>();
  const exclusionIds = new Set<string>();
  for (const rawDomain of input['excludedDomains']) {
    const result = validateExcludedDomain(rawDomain);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    if (hostnames.has(result.value.hostname)) {
      errors.push(`Configuration contains duplicate excluded domain "${result.value.hostname}".`);
      continue;
    }
    if (exclusionIds.has(result.value.id)) {
      errors.push(`Configuration contains duplicate exclusion id "${result.value.id}".`);
      continue;
    }
    hostnames.add(result.value.hostname);
    exclusionIds.add(result.value.id);
    excludedDomains.push(result.value);
  }
  if (errors.length > 0) return { ok: false, errors };

  const processedRequestIds = Array.isArray(input['processedRequestIds'])
    ? input['processedRequestIds'].filter((id): id is string => typeof id === 'string').slice(-100)
    : [];
  return {
    ok: true,
    value: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rules,
      settings: validateSettings(input['settings']),
      excludedDomains,
      updatedAt: numberValue(input['updatedAt'], Date.now()),
      processedRequestIds,
    },
    warnings,
  };
}

export function migrateLegacyConfig(rulesInput: unknown, settingsInput: unknown, now = Date.now()): ValidationResult<StoredConfig> {
  const config = createDefaultConfig(now);
  config.settings = validateSettings(settingsInput);
  if (!Array.isArray(rulesInput)) return { ok: true, value: config, warnings: [] };

  const warnings: string[] = [];
  const signatures = new Set<string>();
  const ids = new Set<string>();
  for (const rawRule of rulesInput) {
    const result = validateRule(rawRule, now);
    if (!result.ok) {
      warnings.push(`An invalid legacy rule was skipped: ${result.errors.join(' ')}`);
      continue;
    }
    const signature = ruleSignature(result.value);
    if (signatures.has(signature)) {
      warnings.push(`Duplicate rule "${result.value.value}" was skipped.`);
      continue;
    }
    if (ids.has(result.value.id)) {
      result.value.id = createId();
      warnings.push(`A duplicate legacy rule id was replaced for "${result.value.value}".`);
    }
    ids.add(result.value.id);
    signatures.add(signature);
    config.rules.push(result.value);
    warnings.push(...result.warnings);
  }
  return { ok: true, value: config, warnings };
}

export function parseImport(input: unknown): ValidationResult<ExportBundle> {
  const record = isRecord(input) ? input : null;
  if (record && record['schemaVersion'] !== undefined && record['schemaVersion'] !== 1 && record['schemaVersion'] !== CURRENT_SCHEMA_VERSION) {
    return { ok: false, errors: ['This export was created with an unsupported schema version.'] };
  }
  const rawRules = Array.isArray(input) ? input : record?.['rules'];
  if (!Array.isArray(rawRules)) return { ok: false, errors: ['Unrecognized import format.'] };

  const rules: BlockRule[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const signatures = new Set<string>();
  const ruleIds = new Set<string>();
  for (const [index, rawRule] of rawRules.entries()) {
    const result = validateRule(rawRule);
    if (!result.ok) {
      errors.push(`Rule ${index + 1}: ${result.errors.join(' ')}`);
      continue;
    }
    const signature = ruleSignature(result.value);
    if (signatures.has(signature)) {
      warnings.push(`Duplicate rule "${result.value.value}" was skipped.`);
      continue;
    }
    if (ruleIds.has(result.value.id)) {
      result.value.id = createId();
      warnings.push(`A duplicate rule id was replaced for "${result.value.value}".`);
    }
    signatures.add(signature);
    ruleIds.add(result.value.id);
    rules.push(result.value);
    warnings.push(...result.warnings);
  }

  const excludedDomains: ExcludedDomain[] = [];
  const hostnames = new Set<string>();
  const exclusionIds = new Set<string>();
  const rawDomains = record?.['excludedDomains'];
  if (Array.isArray(rawDomains)) {
    for (const [index, rawDomain] of rawDomains.entries()) {
      const result = validateExcludedDomain(rawDomain);
      if (!result.ok) {
        errors.push(`Excluded domain ${index + 1}: ${result.errors.join(' ')}`);
      } else if (hostnames.has(result.value.hostname)) {
        warnings.push(`Duplicate excluded domain "${result.value.hostname}" was skipped.`);
      } else {
        if (exclusionIds.has(result.value.id)) {
          result.value.id = createId();
          warnings.push(`A duplicate exclusion id was replaced for "${result.value.hostname}".`);
        }
        hostnames.add(result.value.hostname);
        exclusionIds.add(result.value.id);
        excludedDomains.push(result.value);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  if (rules.length === 0 && excludedDomains.length === 0) {
    return { ok: false, errors: ['The file contains no rules or excluded domains.'] };
  }

  return {
    ok: true,
    value: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: numberValue(record?.['exportedAt'], Date.now()),
      rules,
      settings: validateSettings(record?.['settings']),
      excludedDomains,
    },
    warnings,
  };
}
