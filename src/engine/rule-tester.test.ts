import { describe, expect, it } from 'vitest';
import type { RuleDraft } from '../shared/types.js';
import { MAX_RULE_TEST_TEXT_LENGTH, testRuleDraft } from './rule-tester.js';

const draft: RuleDraft = {
  type: 'keyword', value: 'daily news', aliases: [], caseSensitive: false, wholeWord: false,
};

describe('rule tester', () => {
  it('waits until sample text is provided', () => {
    expect(testRuleDraft(draft, '')).toEqual({ status: 'empty' });
  });

  it('uses production normalization and matching', () => {
    expect(testRuleDraft(draft, 'DAILY\u200b   NEWS update')).toMatchObject({ status: 'match', matchedText: 'daily news' });
  });

  it('tests aliases and whole-word boundaries', () => {
    const aliasDraft = { ...draft, value: 'primary', aliases: ['alternate'], wholeWord: true };
    expect(testRuleDraft(aliasDraft, 'An alternate update')).toMatchObject({ status: 'match' });
    expect(testRuleDraft(aliasDraft, 'An alternately written update')).toEqual({ status: 'no_match' });
  });

  it('reports unsafe regex validation before execution', () => {
    expect(testRuleDraft({ ...draft, type: 'regex', value: '(a+)+$' }, 'aaaa')).toMatchObject({ status: 'invalid' });
  });

  it('supports regex backreferences', () => {
    expect(testRuleDraft({ ...draft, type: 'regex', value: String.raw`\b(\w+)\s+\1\b` }, 'this is is repeated')).toMatchObject({ status: 'match' });
  });

  it('limits sample text to the scanner maximum', () => {
    expect(testRuleDraft(draft, 'a'.repeat(MAX_RULE_TEST_TEXT_LENGTH + 1))).toMatchObject({ status: 'invalid' });
  });
});
