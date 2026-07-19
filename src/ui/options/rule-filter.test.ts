import { describe, expect, it } from 'vitest';
import type { BlockRule } from '../../shared/types.js';
import { filterRules } from './rule-filter.js';

function rule(id: string, value: string, overrides: Partial<BlockRule> = {}): BlockRule {
  return {
    id, type: 'keyword', value, aliases: [], enabled: true,
    caseSensitive: false, wholeWord: false, createdAt: 1, updatedAt: 1,
    ...overrides,
  };
}

const rules = [
  rule('one', 'Daily News', { aliases: ['Morning report'] }),
  rule('two', 'Creator Name', { type: 'creator', enabled: false }),
  rule('three', 'episode\\s+\\d+', { type: 'regex' }),
];

describe('rule filters', () => {
  it('searches values without case sensitivity', () => {
    expect(filterRules(rules, { query: 'daily', type: 'all', state: 'all' }).map((item) => item.id)).toEqual(['one']);
  });

  it('searches aliases and rule types', () => {
    expect(filterRules(rules, { query: 'morning', type: 'all', state: 'all' }).map((item) => item.id)).toEqual(['one']);
    expect(filterRules(rules, { query: 'regex', type: 'all', state: 'all' }).map((item) => item.id)).toEqual(['three']);
  });

  it('uses the same accent normalization as production matching', () => {
    const accented = [rule('accented', 'Café update')];
    expect(filterRules(accented, { query: 'cafe', type: 'all', state: 'all' }).map((item) => item.id)).toEqual(['accented']);
  });

  it('combines type and enabled-state filters', () => {
    expect(filterRules(rules, { query: '', type: 'creator', state: 'disabled' }).map((item) => item.id)).toEqual(['two']);
    expect(filterRules(rules, { query: '', type: 'creator', state: 'enabled' })).toEqual([]);
  });

  it('does not mutate or reorder the source list', () => {
    const result = filterRules(rules, { query: '', type: 'all', state: 'all' });
    expect(result.map((item) => item.id)).toEqual(['one', 'two', 'three']);
    expect(rules.map((item) => item.id)).toEqual(['one', 'two', 'three']);
  });
});
