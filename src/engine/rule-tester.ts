import { compile, test } from './matcher.js';
import type { RuleDraft } from '../shared/types.js';
import { validateRuleDraft } from '../shared/validation.js';

export const MAX_RULE_TEST_TEXT_LENGTH = 5000;

export type RuleTestOutcome =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'no_match' }
  | { status: 'match'; matchedText: string };

export function testRuleDraft(draft: RuleDraft, sampleText: string): RuleTestOutcome {
  if (!sampleText) return { status: 'empty' };
  if (sampleText.length > MAX_RULE_TEST_TEXT_LENGTH) {
    return { status: 'invalid', message: `Sample text is limited to ${MAX_RULE_TEST_TEXT_LENGTH} characters.` };
  }
  const validation = validateRuleDraft(draft);
  if (!validation.ok) return { status: 'invalid', message: validation.errors.join(' ') };
  const now = Date.now();
  const result = test(compile([{
    id: 'rule-tester',
    ...validation.value,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }]), sampleText);
  return result.matched
    ? { status: 'match', matchedText: result.matchedText }
    : { status: 'no_match' };
}
