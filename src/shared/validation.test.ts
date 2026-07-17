import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './types.js';
import { migrateLegacyConfig, parseImport, validateConfig, validateRegexPattern, validateRuleDraft } from './validation.js';

describe('configuration validation', () => {
  it('rejects unsafe regular expressions', () => {
    expect(validateRegexPattern('(a+)+$')).toMatch(/unsafe repetition/);
    expect(validateRegexPattern('(a|aa)+$')).toMatch(/unsafe repetition/);
    expect(validateRegexPattern('.*middle.*end')).toMatch(/unsafe repetition/);
    expect(validateRegexPattern(String.raw`\b(\w+)\s+\1\b`)).toBeNull();
  });

  it('normalizes a valid rule draft', () => {
    const result = validateRuleDraft({
      type: 'keyword',
      value: '  example  ',
      aliases: [' alias ', '', 'alias'],
      caseSensitive: false,
      wholeWord: true,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { value: 'example', aliases: ['alias'], wholeWord: true },
    });
  });

  it('rejects unsupported stored schemas instead of guessing', () => {
    expect(validateConfig({ ...createDefaultConfig(), schemaVersion: 99 }).ok).toBe(false);
  });

  it('rejects duplicate identifiers in canonical stored configuration', () => {
    const config = createDefaultConfig(1);
    config.rules = [
      { id: 'same', type: 'keyword', value: 'one', aliases: [], enabled: true, caseSensitive: false, wholeWord: false, createdAt: 1, updatedAt: 1 },
      { id: 'same', type: 'keyword', value: 'two', aliases: [], enabled: true, caseSensitive: false, wholeWord: false, createdAt: 1, updatedAt: 1 },
    ];
    expect(validateConfig(config).ok).toBe(false);
  });

  it('migrates valid legacy rules and skips invalid ones', () => {
    const migration = migrateLegacyConfig([
      { id: 'valid', type: 'keyword', value: 'keep me', enabled: true },
      { id: 'invalid', type: 'regex', value: '(a+)+$', enabled: true },
    ], { enabled: false, debug: true }, 100);
    expect(migration.ok).toBe(true);
    if (!migration.ok) return;
    expect(migration.value.rules.map((rule) => rule.value)).toEqual(['keep me']);
    expect(migration.value.settings).toEqual({ enabled: false, debug: true });
    expect(migration.warnings).toHaveLength(1);
  });

  it('validates legacy array exports and versioned exports', () => {
    const legacy = parseImport([{ type: 'keyword', value: 'one' }]);
    expect(legacy.ok).toBe(true);
    const versioned = parseImport({
      schemaVersion: 2,
      rules: [{ type: 'keyword', value: 'two' }],
      excludedDomains: [{ hostname: 'example.com' }],
    });
    expect(versioned).toMatchObject({ ok: true, value: { excludedDomains: [{ hostname: 'example.com' }] } });
  });

  it('rejects an import atomically if any item is invalid', () => {
    const result = parseImport({ rules: [
      { type: 'keyword', value: 'valid' },
      { type: 'regex', value: '(a+)+$' },
    ] });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown export schema versions', () => {
    expect(parseImport({ schemaVersion: 99, rules: [{ type: 'keyword', value: 'one' }] }).ok).toBe(false);
  });
});
