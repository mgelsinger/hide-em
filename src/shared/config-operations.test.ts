import { describe, expect, it } from 'vitest';
import { applyConfigCommand } from './config-operations.js';
import { createDefaultConfig } from './types.js';
import type { RuleDraft } from './types.js';

const draft: RuleDraft = {
  type: 'keyword',
  value: 'example',
  aliases: [],
  caseSensitive: false,
  wholeWord: false,
};

describe('serialized configuration operations', () => {
  it('preserves successive additions made from the latest config', () => {
    const first = applyConfigCommand(createDefaultConfig(1), { type: 'rule.add', requestId: 'one', draft }).config;
    const second = applyConfigCommand(first, {
      type: 'rule.add',
      requestId: 'two',
      draft: { ...draft, value: 'second' },
    }).config;
    expect(second.rules.map((rule) => rule.value)).toEqual(['example', 'second']);
  });

  it('does not apply the same request twice', () => {
    const first = applyConfigCommand(createDefaultConfig(1), { type: 'rule.add', requestId: 'same', draft }).config;
    const repeated = applyConfigCommand(first, { type: 'rule.add', requestId: 'same', draft });
    expect(repeated.config).toBe(first);
    expect(repeated.config.rules).toHaveLength(1);
  });

  it('deduplicates an equivalent rule and enables the existing item', () => {
    const first = applyConfigCommand(createDefaultConfig(1), { type: 'rule.add', requestId: 'one', draft }).config;
    first.rules[0].enabled = false;
    const duplicate = applyConfigCommand(first, {
      type: 'rule.add',
      requestId: 'two',
      draft: { ...draft, value: 'EXAMPLE' },
    }).config;
    expect(duplicate.rules).toHaveLength(1);
    expect(duplicate.rules[0].enabled).toBe(true);
  });

  it('normalizes and deduplicates domain exclusions', () => {
    const first = applyConfigCommand(createDefaultConfig(1), {
      type: 'exclusion.add', requestId: 'one', input: 'https://Twitch.tv/directory',
    }).config;
    const duplicate = applyConfigCommand(first, {
      type: 'exclusion.add', requestId: 'two', input: 'twitch.tv',
    }).config;
    expect(duplicate.excludedDomains).toHaveLength(1);
    expect(duplicate.excludedDomains[0].hostname).toBe('twitch.tv');
  });

  it('leaves the original configuration untouched when an import fails', () => {
    const original = createDefaultConfig(1);
    expect(() => applyConfigCommand(original, {
      type: 'import.apply',
      requestId: 'bad-import',
      mode: 'merge',
      data: { rules: [{ type: 'regex', value: '(a+)+$' }] },
    })).toThrow();
    expect(original).toEqual(createDefaultConfig(1));
  });

  it('merges imports without duplicating equivalent rules or domains', () => {
    const original = applyConfigCommand(createDefaultConfig(1), { type: 'rule.add', requestId: 'one', draft }).config;
    const merged = applyConfigCommand(original, {
      type: 'import.apply',
      requestId: 'import',
      mode: 'merge',
      data: {
        rules: [{ type: 'keyword', value: 'EXAMPLE' }, { type: 'keyword', value: 'new value' }],
        excludedDomains: [{ hostname: 'example.com' }, { hostname: 'example.com' }],
      },
    }).config;
    expect(merged.rules.map((rule) => rule.value)).toEqual(['example', 'new value']);
    expect(merged.excludedDomains).toHaveLength(1);
  });

  it('preserves a concurrent enabled state while editing rule content', () => {
    const original = applyConfigCommand(createDefaultConfig(1), { type: 'rule.add', requestId: 'one', draft }).config;
    original.rules[0].enabled = false;
    const edited = applyConfigCommand(original, {
      type: 'rule.update',
      requestId: 'edit',
      rule: { ...original.rules[0], value: 'edited', enabled: true },
    }).config;
    expect(edited.rules[0]).toMatchObject({ value: 'edited', enabled: false });
  });

  it('does not deduplicate regex patterns whose escape case changes their meaning', () => {
    const first = applyConfigCommand(createDefaultConfig(1), {
      type: 'rule.add',
      requestId: 'digits',
      draft: { ...draft, type: 'regex', value: String.raw`\d+` },
    }).config;
    const second = applyConfigCommand(first, {
      type: 'rule.add',
      requestId: 'non-digits',
      draft: { ...draft, type: 'regex', value: String.raw`\D+` },
    }).config;
    expect(second.rules).toHaveLength(2);
  });
});
