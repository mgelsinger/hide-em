import { normalize } from './normalize.js';

export type Platform = 'youtube' | 'twitter' | 'reddit' | 'twitch' | 'tiktok';
export type RuleType = 'creator' | 'keyword' | 'phrase' | 'regex';
export type HideAction = 'hide' | 'collapse' | 'blur';

export type RuleScope = {
  titles: boolean;
  channels: boolean;
  comments: boolean;
  descriptions: boolean;
};

export type BlockRule = {
  id: string;
  type: RuleType;
  value: string;
  aliases: string[];
  enabled: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  platforms: Platform[] | 'all';
  scope: RuleScope;
  action: HideAction;
  hits: number;
  createdAt: number;
  updatedAt: number;
};

export type CompiledRuleset = {
  byScope: Record<keyof RuleScope, RegExp | null>;
  byScopeCS: Record<keyof RuleScope, RegExp | null>;
  ruleIndex: Map<string, BlockRule>;
  groupToRuleId: Map<string, string>;
  fingerprint: string;
};

export type MatchResult =
  | { matched: false }
  | { matched: true; ruleId: string; matchedText: string };

const SCOPES: Array<keyof RuleScope> = ['titles', 'channels', 'comments', 'descriptions'];
const REGEX_MAX_LEN = 200;
// Heuristic: reject patterns with nested quantifiers like (a+)+ or (.*)*
const NESTED_QUANT_RE = /\([^()]*[+*][^()]*\)\s*[+*?{]/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patternForRule(rule: BlockRule): string | null {
  if (rule.type === 'regex') {
    const p = rule.value;
    if (!p || p.length > REGEX_MAX_LEN) return null;
    if (NESTED_QUANT_RE.test(p)) return null;
    try {
      new RegExp(p, rule.caseSensitive ? 'u' : 'iu');
    } catch {
      return null;
    }
    return `(?:${p})`;
  }

  const values = [rule.value, ...rule.aliases]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => normalize(v, rule.caseSensitive))
    .filter((v) => v.length > 0)
    .map(escapeRegex);

  if (values.length === 0) return null;

  const alt = values.length === 1 ? values[0] : `(?:${values.join('|')})`;
  return rule.wholeWord ? `\\b${alt}\\b` : alt;
}

function fingerprint(rules: BlockRule[]): string {
  const parts = rules
    .filter((r) => r.enabled)
    .map((r) => {
      const scopeKey = SCOPES.filter((s) => r.scope[s]).join('');
      return `${r.id}:${r.type}:${r.value}:${r.aliases.join(',')}:` +
        `${r.caseSensitive ? 1 : 0}:${r.wholeWord ? 1 : 0}:${scopeKey}`;
    });
  parts.sort();
  let h = 0x811c9dc5;
  const joined = parts.join('|');
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export function compile(rules: BlockRule[]): CompiledRuleset {
  const ruleIndex = new Map<string, BlockRule>();
  const groupToRuleId = new Map<string, string>();

  const partsByScope: Record<keyof RuleScope, { ci: string[]; cs: string[] }> = {
    titles: { ci: [], cs: [] },
    channels: { ci: [], cs: [] },
    comments: { ci: [], cs: [] },
    descriptions: { ci: [], cs: [] },
  };

  let groupCounter = 0;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const pattern = patternForRule(rule);
    if (pattern === null) continue;

    const groupName = `r${groupCounter++}`;
    let named: string;
    try {
      // Verify the named-group wrapped pattern compiles in isolation
      new RegExp(`(?<${groupName}>${pattern})`, rule.caseSensitive ? 'u' : 'iu');
      named = `(?<${groupName}>${pattern})`;
    } catch {
      continue;
    }

    ruleIndex.set(rule.id, rule);
    groupToRuleId.set(groupName, rule.id);

    let added = false;
    for (const scope of SCOPES) {
      if (rule.scope[scope]) {
        if (rule.caseSensitive) partsByScope[scope].cs.push(named);
        else partsByScope[scope].ci.push(named);
        added = true;
      }
    }
    if (!added) {
      ruleIndex.delete(rule.id);
      groupToRuleId.delete(groupName);
    }
  }

  const byScope: Record<keyof RuleScope, RegExp | null> = {
    titles: null, channels: null, comments: null, descriptions: null,
  };
  const byScopeCS: Record<keyof RuleScope, RegExp | null> = {
    titles: null, channels: null, comments: null, descriptions: null,
  };

  for (const scope of SCOPES) {
    const ci = partsByScope[scope].ci;
    const cs = partsByScope[scope].cs;
    if (ci.length > 0) {
      try { byScope[scope] = new RegExp(ci.join('|'), 'iu'); }
      catch { byScope[scope] = null; }
    }
    if (cs.length > 0) {
      try { byScopeCS[scope] = new RegExp(cs.join('|'), 'u'); }
      catch { byScopeCS[scope] = null; }
    }
  }

  return {
    byScope,
    byScopeCS,
    ruleIndex,
    groupToRuleId,
    fingerprint: fingerprint(rules),
  };
}

function findMatch(
  regex: RegExp,
  text: string,
  groupToRuleId: Map<string, string>,
): MatchResult {
  const m = regex.exec(text);
  if (!m) return { matched: false };
  if (m.groups) {
    for (const name of Object.keys(m.groups)) {
      const value = m.groups[name];
      if (value !== undefined) {
        const ruleId = groupToRuleId.get(name);
        if (ruleId !== undefined) {
          return { matched: true, ruleId, matchedText: value };
        }
      }
    }
  }
  return { matched: true, ruleId: '', matchedText: m[0] };
}

export function test(
  compiled: CompiledRuleset,
  text: string,
  scope: keyof RuleScope,
): MatchResult {
  const ciRegex = compiled.byScope[scope];
  const csRegex = compiled.byScopeCS[scope];
  if (!ciRegex && !csRegex) return { matched: false };

  if (ciRegex) {
    const norm = normalize(text, false);
    const r = findMatch(ciRegex, norm, compiled.groupToRuleId);
    if (r.matched) return r;
  }
  if (csRegex) {
    const norm = normalize(text, true);
    const r = findMatch(csRegex, norm, compiled.groupToRuleId);
    if (r.matched) return r;
  }
  return { matched: false };
}

export function testMulti(
  compiled: CompiledRuleset,
  fields: Partial<Record<keyof RuleScope, string>>,
): MatchResult {
  for (const scope of SCOPES) {
    const text = fields[scope];
    if (text === undefined) continue;
    const r = test(compiled, text, scope);
    if (r.matched) return r;
  }
  return { matched: false };
}
