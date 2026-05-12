import { describe, it, expect } from 'vitest';
import { compile, test, testMulti, type BlockRule, type RuleScope } from './matcher.js';

let nextId = 0;
function rid(): string {
  return `rule-${++nextId}`;
}

const ALL_SCOPES: RuleScope = {
  titles: true,
  channels: true,
  comments: true,
  descriptions: true,
};

function makeRule(overrides: Partial<BlockRule> = {}): BlockRule {
  const type = overrides.type ?? 'keyword';
  const wholeWordDefault = type === 'creator';
  return {
    id: overrides.id ?? rid(),
    type,
    value: overrides.value ?? '',
    aliases: overrides.aliases ?? [],
    enabled: overrides.enabled ?? true,
    caseSensitive: overrides.caseSensitive ?? false,
    wholeWord: overrides.wholeWord ?? wholeWordDefault,
    platforms: overrides.platforms ?? 'all',
    scope: overrides.scope ?? { ...ALL_SCOPES },
    action: overrides.action ?? 'hide',
    hits: overrides.hits ?? 0,
    createdAt: overrides.createdAt ?? 0,
    updatedAt: overrides.updatedAt ?? 0,
  };
}

function onlyScope(scope: keyof RuleScope): RuleScope {
  return {
    titles: scope === 'titles',
    channels: scope === 'channels',
    comments: scope === 'comments',
    descriptions: scope === 'descriptions',
  };
}

describe('compile', () => {
  it('skips disabled rules', () => {
    const rule = makeRule({ value: 'kim', enabled: false });
    const c = compile([rule]);
    expect(c.byScope.titles).toBeNull();
    expect(c.ruleIndex.has(rule.id)).toBe(false);
  });

  it('skips empty-value non-regex rules', () => {
    const rule = makeRule({ value: '' });
    const c = compile([rule]);
    expect(c.byScope.titles).toBeNull();
  });

  it('produces a stable fingerprint for the same rule set', () => {
    const a = makeRule({ id: 'a', value: 'kim' });
    const b = makeRule({ id: 'b', value: 'jynxzi' });
    const c1 = compile([a, b]);
    const c2 = compile([b, a]);
    expect(c1.fingerprint).toBe(c2.fingerprint);
  });

  it('changes the fingerprint when a rule changes', () => {
    const a = makeRule({ id: 'a', value: 'kim' });
    const b = { ...a, value: 'kanye' };
    expect(compile([a]).fingerprint).not.toBe(compile([b]).fingerprint);
  });
});

describe('rule types', () => {
  it('matches a creator rule with whole-word default', () => {
    const rule = makeRule({ type: 'creator', value: 'MrBeast' });
    const c = compile([rule]);
    expect(test(c, 'MrBeast Plays Squid Game', 'titles').matched).toBe(true);
    const r = test(c, 'MrBeast Plays Squid Game', 'titles');
    if (r.matched) expect(r.ruleId).toBe(rule.id);
  });

  it('matches a keyword rule (substring by default)', () => {
    const rule = makeRule({ type: 'keyword', value: 'drama' });
    const c = compile([rule]);
    expect(test(c, 'the drama unfolds', 'titles').matched).toBe(true);
    expect(test(c, 'a melodramatic moment', 'titles').matched).toBe(true);
  });

  it('matches a phrase rule across multiple words', () => {
    const rule = makeRule({ type: 'phrase', value: 'breaking news' });
    const c = compile([rule]);
    expect(test(c, 'this just in: BREAKING NEWS at 11', 'titles').matched).toBe(true);
    expect(test(c, 'breaking the news cycle', 'titles').matched).toBe(false);
  });

  it('matches a regex rule', () => {
    const rule = makeRule({ type: 'regex', value: 'ep\\.?\\s*\\d+' });
    const c = compile([rule]);
    expect(test(c, 'final fantasy ep. 12 review', 'titles').matched).toBe(true);
    expect(test(c, 'final fantasy ep 7 review', 'titles').matched).toBe(true);
    expect(test(c, 'just a regular title', 'titles').matched).toBe(false);
  });

  it('attributes the matched ruleId across mixed types', () => {
    const r1 = makeRule({ id: 'a', type: 'creator', value: 'MrBeast' });
    const r2 = makeRule({ id: 'b', type: 'keyword', value: 'drama' });
    const c = compile([r1, r2]);

    const m1 = test(c, 'MrBeast tour', 'titles');
    const m2 = test(c, 'so much drama today', 'titles');
    if (m1.matched) expect(m1.ruleId).toBe('a');
    if (m2.matched) expect(m2.ruleId).toBe('b');
  });
});

describe('scopes', () => {
  for (const scope of ['titles', 'channels', 'comments', 'descriptions'] as const) {
    it(`matches text only in scope ${scope}`, () => {
      const rule = makeRule({ value: 'kanye', scope: onlyScope(scope) });
      const c = compile([rule]);

      // Matches the active scope
      expect(test(c, 'about kanye today', scope).matched).toBe(true);

      // Does not match in other scopes
      for (const other of ['titles', 'channels', 'comments', 'descriptions'] as const) {
        if (other === scope) continue;
        expect(test(c, 'about kanye today', other).matched).toBe(false);
      }
    });
  }

  it('only compiles a scope when at least one rule applies to it', () => {
    const rule = makeRule({ value: 'kim', scope: onlyScope('comments') });
    const c = compile([rule]);
    expect(c.byScope.titles).toBeNull();
    expect(c.byScope.channels).toBeNull();
    expect(c.byScope.descriptions).toBeNull();
    expect(c.byScope.comments).not.toBeNull();
  });
});

describe('case sensitivity', () => {
  it('matches case-insensitively by default', () => {
    const rule = makeRule({ value: 'JynxZi' });
    const c = compile([rule]);
    expect(test(c, 'JYNXZI dominates ranked', 'titles').matched).toBe(true);
    expect(test(c, 'jynxzi dominates ranked', 'titles').matched).toBe(true);
    expect(test(c, 'Jynxzi dominates ranked', 'titles').matched).toBe(true);
  });

  it('respects caseSensitive: true on a rule', () => {
    const rule = makeRule({ value: 'API', caseSensitive: true });
    const c = compile([rule]);
    expect(test(c, 'new API release notes', 'titles').matched).toBe(true);
    expect(test(c, 'new api release notes', 'titles').matched).toBe(false);
  });
});

describe('word boundary behavior', () => {
  it('creator wholeWord prevents matching inside larger words', () => {
    const rule = makeRule({ type: 'creator', value: 'Tom' });
    const c = compile([rule]);
    expect(test(c, 'Tomato salad recipe', 'titles').matched).toBe(false);
    expect(test(c, 'tomcat ascii art', 'titles').matched).toBe(false);
    expect(test(c, 'mostly autumn', 'titles').matched).toBe(false);
  });

  it('creator wholeWord still matches at word boundaries', () => {
    const rule = makeRule({ type: 'creator', value: 'Tom' });
    const c = compile([rule]);
    expect(test(c, 'Tom and Jerry', 'titles').matched).toBe(true);
    expect(test(c, 'I met Tom yesterday', 'titles').matched).toBe(true);
    expect(test(c, 'Tom.', 'titles').matched).toBe(true);
    expect(test(c, '@Tom', 'titles').matched).toBe(true);
  });

  it('substring keyword (wholeWord=false) does match inside words', () => {
    const rule = makeRule({ type: 'keyword', value: 'tom', wholeWord: false });
    const c = compile([rule]);
    expect(test(c, 'tomato salad', 'titles').matched).toBe(true);
  });
});

describe('Unicode normalization edge cases', () => {
  it('matches ZWJ-spliced names', () => {
    const rule = makeRule({ value: 'jynxzi' });
    const c = compile([rule]);
    // ZWJ inserted between J and y
    const text = 'check out J‍ynxzi today';
    expect(test(c, text, 'titles').matched).toBe(true);
  });

  it('matches text with ZWNJ inserted', () => {
    const rule = makeRule({ value: 'mrbeast' });
    const c = compile([rule]);
    expect(test(c, 'mr‌beast challenge', 'titles').matched).toBe(true);
  });

  it('matches text with ZWSP inserted inside a word', () => {
    const rule = makeRule({ value: 'kardashian' });
    const c = compile([rule]);
    expect(test(c, 'kar​dashian update', 'titles').matched).toBe(true);
  });

  it('strips BOM characters', () => {
    const rule = makeRule({ value: 'kanye' });
    const c = compile([rule]);
    expect(test(c, '﻿kanye news', 'titles').matched).toBe(true);
  });

  it('matches diacritic variants via NFKD decomposition', () => {
    const rule = makeRule({ value: 'jynxzi' });
    const c = compile([rule]);
    expect(test(c, 'Jynxzí is streaming', 'titles').matched).toBe(true);
    expect(test(c, 'Jÿnxzï is streaming', 'titles').matched).toBe(true);
  });

  it('matches when the rule itself is given with diacritics', () => {
    const rule = makeRule({ value: 'Beyoncé' });
    const c = compile([rule]);
    expect(test(c, 'Beyonce just dropped a single', 'titles').matched).toBe(true);
    expect(test(c, 'BEYONCÉ just dropped a single', 'titles').matched).toBe(true);
  });

  it('matches fullwidth Latin letters via NFKD', () => {
    const rule = makeRule({ value: 'hello' });
    const c = compile([rule]);
    // 'ＨＥＬＬＯ' is fullwidth HELLO
    expect(test(c, 'ＨＥＬＬＯ world', 'titles').matched).toBe(true);
  });

  it('collapses runs of whitespace', () => {
    const rule = makeRule({ type: 'phrase', value: 'breaking news' });
    const c = compile([rule]);
    expect(test(c, 'BREAKING\t\t\n  NEWS at midnight', 'titles').matched).toBe(true);
  });

  it('combines several edge cases at once', () => {
    const rule = makeRule({ value: 'kimkardashian' });
    const c = compile([rule]);
    // Fullwidth K + diacritic i + ZWJ + rest
    const text = 'Ｋim‍kardashian update';
    expect(test(c, text, 'titles').matched).toBe(true);
  });
});

describe('testMulti', () => {
  it('returns the first matching scope (titles before comments)', () => {
    const titleRule = makeRule({ id: 'title-r', value: 'kim', scope: onlyScope('titles') });
    const commentRule = makeRule({ id: 'comment-r', value: 'kanye', scope: onlyScope('comments') });
    const c = compile([titleRule, commentRule]);

    const r = testMulti(c, {
      titles: 'about kim today',
      comments: 'kanye said something',
    });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.ruleId).toBe('title-r');
  });

  it('short-circuits before evaluating later scopes (no later-rule attribution)', () => {
    const r1 = makeRule({ id: 'first', value: 'apple', scope: onlyScope('titles') });
    const r2 = makeRule({ id: 'second', value: 'banana', scope: onlyScope('descriptions') });
    const c = compile([r1, r2]);

    // Both scopes contain matching text; result must be the titles rule, never the descriptions one.
    const r = testMulti(c, {
      titles: 'apple is here',
      descriptions: 'banana is also here',
    });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.ruleId).toBe('first');
  });

  it('skips scopes whose text is undefined', () => {
    const rule = makeRule({ value: 'kanye', scope: onlyScope('descriptions') });
    const c = compile([rule]);
    const r = testMulti(c, { descriptions: 'kanye news' });
    expect(r.matched).toBe(true);
  });

  it('returns matched: false when no scope matches', () => {
    const rule = makeRule({ value: 'kim' });
    const c = compile([rule]);
    expect(testMulti(c, { titles: 'just a normal video' }).matched).toBe(false);
  });

  it('returns matched: false when fields is empty', () => {
    const rule = makeRule({ value: 'kim' });
    const c = compile([rule]);
    expect(testMulti(c, {}).matched).toBe(false);
  });
});

describe('regex safety', () => {
  it('does not throw on a syntactically malformed pattern', () => {
    const rule = makeRule({ type: 'regex', value: '([unclosed' });
    expect(() => compile([rule])).not.toThrow();
    const c = compile([rule]);
    expect(c.byScope.titles).toBeNull();
  });

  it('does not throw on a pattern exceeding the length cap', () => {
    const rule = makeRule({ type: 'regex', value: 'a'.repeat(500) });
    expect(() => compile([rule])).not.toThrow();
    const c = compile([rule]);
    expect(c.byScope.titles).toBeNull();
  });

  it('rejects nested-quantifier patterns', () => {
    const rule = makeRule({ type: 'regex', value: '(a+)+' });
    const c = compile([rule]);
    expect(c.byScope.titles).toBeNull();
  });

  it('still compiles other valid rules when one regex rule is bad', () => {
    const bad = makeRule({ id: 'bad', type: 'regex', value: '([unclosed' });
    const good = makeRule({ id: 'good', value: 'kim' });
    const c = compile([bad, good]);
    expect(c.byScope.titles).not.toBeNull();
    expect(test(c, 'kim story', 'titles').matched).toBe(true);
  });

  it('aliases of regex rules are ignored as patterns (no injection of arbitrary regex syntax)', () => {
    // Even if aliases contain regex metacharacters, regex rules should only use `value`.
    const rule = makeRule({
      type: 'regex',
      value: '\\d{3}',
      aliases: ['([broken'],
    });
    const c = compile([rule]);
    expect(c.byScope.titles).not.toBeNull();
    expect(test(c, 'abc 123 def', 'titles').matched).toBe(true);
  });
});
