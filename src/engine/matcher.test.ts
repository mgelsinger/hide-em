import { describe, expect, it } from 'vitest';
import { compile, test } from './matcher.js';
import type { BlockRule } from '../shared/types.js';

let nextId = 0;

function rule(overrides: Partial<BlockRule> = {}): BlockRule {
  nextId += 1;
  return {
    id: `rule-${nextId}`,
    type: 'keyword',
    value: 'example',
    aliases: [],
    enabled: true,
    caseSensitive: false,
    wholeWord: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('matcher', () => {
  it('returns no match for an empty ruleset', () => {
    expect(test(compile([]), 'anything')).toEqual({ matched: false });
  });

  it('matches literals without case sensitivity by default', () => {
    const item = rule({ value: 'Creator Name' });
    expect(test(compile([item]), 'A CREATOR NAME update')).toMatchObject({ matched: true, ruleId: item.id });
  });

  it('honors case-sensitive literals', () => {
    const item = rule({ value: 'Name', caseSensitive: true });
    const compiled = compile([item]);
    expect(test(compiled, 'name')).toEqual({ matched: false });
    expect(test(compiled, 'Name')).toMatchObject({ matched: true, ruleId: item.id });
  });

  it('escapes regular expression characters in literal rules', () => {
    const item = rule({ value: 'price $5.00?' });
    const compiled = compile([item]);
    expect(test(compiled, 'The price $5.00? today')).toMatchObject({ matched: true });
    expect(test(compiled, 'The price $5000 today')).toEqual({ matched: false });
  });

  it('matches aliases and returns their owning rule', () => {
    const item = rule({ value: 'primary', aliases: ['alternate'] });
    expect(test(compile([item]), 'alternate name')).toMatchObject({ matched: true, ruleId: item.id });
  });

  it('normalizes accents, whitespace, and zero-width characters', () => {
    const item = rule({ type: 'phrase', value: 'Café daily news' });
    expect(test(compile([item]), 'CAFE\u200b   daily\nnews')).toMatchObject({ matched: true });
  });

  it('uses Unicode-aware whole word boundaries', () => {
    const item = rule({ value: '東京', wholeWord: true });
    const compiled = compile([item]);
    expect(test(compiled, '東京 guide')).toMatchObject({ matched: true });
    expect(test(compiled, '東京都 guide')).toEqual({ matched: false });
  });

  it('allows punctuation next to a whole word', () => {
    const item = rule({ value: 'news', wholeWord: true });
    expect(test(compile([item]), '(news), today')).toMatchObject({ matched: true });
  });

  it('compiles regex rules independently so numeric backreferences work', () => {
    const item = rule({ type: 'regex', value: String.raw`\b(\w+)\s+\1\b` });
    const compiled = compile([item]);
    expect(test(compiled, 'this is is repeated')).toMatchObject({ matched: true, ruleId: item.id });
    expect(test(compiled, 'this is not repeated')).toEqual({ matched: false });
  });

  it('honors regex case sensitivity', () => {
    const item = rule({ type: 'regex', value: 'NEWS', caseSensitive: true });
    const compiled = compile([item]);
    expect(test(compiled, 'news')).toEqual({ matched: false });
    expect(test(compiled, 'NEWS')).toMatchObject({ matched: true });
  });

  it('matches regex aliases independently', () => {
    const item = rule({ type: 'regex', value: String.raw`episode\s+\d+`, aliases: [String.raw`part\s+\d+`] });
    expect(test(compile([item]), 'Watch part 12')).toMatchObject({ matched: true, ruleId: item.id });
  });

  it('skips disabled and unsafe regex rules', () => {
    const disabled = rule({ value: 'blocked', enabled: false });
    const unsafe = rule({ type: 'regex', value: '(a+)+$' });
    const compiled = compile([disabled, unsafe]);
    expect(compiled.ruleIndex.size).toBe(0);
    expect(test(compiled, 'blocked aaaaa')).toEqual({ matched: false });
  });

  it('finds rules across multiple compiled chunks', () => {
    const rules = Array.from({ length: 121 }, (_, index) => rule({ value: `unique-value-${index}-end` }));
    const compiled = compile(rules);
    expect(compiled.literalCI.length).toBe(3);
    expect(test(compiled, 'contains unique-value-120-end')).toMatchObject({ matched: true, ruleId: rules[120].id });
  });

  it('changes its fingerprint when an enabled rule changes', () => {
    const first = rule({ id: 'same', value: 'one' });
    const second = { ...first, value: 'two' };
    expect(compile([first]).fingerprint).not.toBe(compile([second]).fingerprint);
  });

  it('does not change its fingerprint for disabled rule content', () => {
    const first = rule({ id: 'same-disabled', value: 'one', enabled: false });
    const second = { ...first, value: 'two' };
    expect(compile([first]).fingerprint).toBe(compile([second]).fingerprint);
  });
});
