import { normalize } from './normalize.js';
import type { BlockRule } from '../shared/types.js';
import { validateRegexPattern } from '../shared/validation.js';

export type MatchResult =
  | { matched: false }
  | { matched: true; ruleId: string; matchedText: string };

type LiteralChunk = {
  regex: RegExp;
  groupToRuleId: Map<string, string>;
};

type RegexRule = {
  ruleId: string;
  regex: RegExp;
  caseSensitive: boolean;
};

export type CompiledRuleset = {
  literalCI: LiteralChunk[];
  literalCS: LiteralChunk[];
  regexRules: RegexRule[];
  ruleIndex: Map<string, BlockRule>;
  fingerprint: string;
};

const LITERAL_CHUNK_SIZE = 50;
const LITERAL_CHUNK_PATTERN_LENGTH = 20_000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function literalPattern(rule: BlockRule): string | null {
  const values = [rule.value, ...rule.aliases]
    .map((value) => normalize(value, rule.caseSensitive))
    .filter(Boolean)
    .map(escapeRegex);
  if (values.length === 0) return null;
  const alternatives = values.length === 1 ? values[0] : `(?:${values.join('|')})`;
  return rule.wholeWord
    ? `(?<![\\p{L}\\p{N}_])${alternatives}(?![\\p{L}\\p{N}_])`
    : alternatives;
}

function fingerprint(rules: BlockRule[]): string {
  const joined = rules
    .filter((rule) => rule.enabled)
    .map((rule) => JSON.stringify([
      rule.id,
      rule.type,
      rule.value,
      rule.aliases,
      rule.caseSensitive,
      rule.wholeWord,
    ]))
    .sort()
    .join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

function compileLiteralChunks(entries: Array<{ rule: BlockRule; pattern: string }>): LiteralChunk[] {
  const chunks: LiteralChunk[] = [];
  let offset = 0;
  while (offset < entries.length) {
    const slice: Array<{ rule: BlockRule; pattern: string }> = [];
    let patternLength = 0;
    while (offset + slice.length < entries.length && slice.length < LITERAL_CHUNK_SIZE) {
      const entry = entries[offset + slice.length];
      if (slice.length > 0 && patternLength + entry.pattern.length > LITERAL_CHUNK_PATTERN_LENGTH) break;
      slice.push(entry);
      patternLength += entry.pattern.length;
    }
    const groupToRuleId = new Map<string, string>();
    const parts = slice.map(({ rule, pattern }, index) => {
      const groupName = `r${offset + index}`;
      groupToRuleId.set(groupName, rule.id);
      return `(?<${groupName}>${pattern})`;
    });
    const flags = slice[0]?.rule.caseSensitive ? 'u' : 'iu';
    try {
      chunks.push({ regex: new RegExp(parts.join('|'), flags), groupToRuleId });
    } catch {
      for (const { rule, pattern } of slice) {
        const groupName = 'r0';
        chunks.push({
          regex: new RegExp(`(?<${groupName}>${pattern})`, rule.caseSensitive ? 'u' : 'iu'),
          groupToRuleId: new Map([[groupName, rule.id]]),
        });
      }
    }
    offset += slice.length;
  }
  return chunks;
}

export function compile(rules: BlockRule[]): CompiledRuleset {
  const ruleIndex = new Map<string, BlockRule>();
  const ciEntries: Array<{ rule: BlockRule; pattern: string }> = [];
  const csEntries: Array<{ rule: BlockRule; pattern: string }> = [];
  const regexRules: RegexRule[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.type === 'regex') {
      for (const pattern of [rule.value, ...rule.aliases]) {
        if (validateRegexPattern(pattern)) continue;
        try {
          regexRules.push({
            ruleId: rule.id,
            regex: new RegExp(pattern, rule.caseSensitive ? 'u' : 'iu'),
            caseSensitive: rule.caseSensitive,
          });
          ruleIndex.set(rule.id, rule);
        } catch {
          continue;
        }
      }
      continue;
    }

    const pattern = literalPattern(rule);
    if (!pattern) continue;
    (rule.caseSensitive ? csEntries : ciEntries).push({ rule, pattern });
    ruleIndex.set(rule.id, rule);
  }

  return {
    literalCI: compileLiteralChunks(ciEntries),
    literalCS: compileLiteralChunks(csEntries),
    regexRules,
    ruleIndex,
    fingerprint: fingerprint(rules),
  };
}

function testChunk(chunk: LiteralChunk, text: string): MatchResult {
  const match = chunk.regex.exec(text);
  if (!match) return { matched: false };
  if (match.groups) {
    for (const [name, value] of Object.entries(match.groups)) {
      if (value === undefined) continue;
      const ruleId = chunk.groupToRuleId.get(name);
      if (ruleId) return { matched: true, ruleId, matchedText: value };
    }
  }
  return { matched: false };
}

export function test(compiled: CompiledRuleset, text: string): MatchResult {
  if (compiled.ruleIndex.size === 0) return { matched: false };

  let normalizedCI: string | null = null;
  if (compiled.literalCI.length > 0 || compiled.regexRules.some((rule) => !rule.caseSensitive)) {
    normalizedCI = normalize(text, false);
  }
  for (const chunk of compiled.literalCI) {
    const result = testChunk(chunk, normalizedCI ?? '');
    if (result.matched) return result;
  }

  let normalizedCS: string | null = null;
  if (compiled.literalCS.length > 0 || compiled.regexRules.some((rule) => rule.caseSensitive)) {
    normalizedCS = normalize(text, true);
  }
  for (const chunk of compiled.literalCS) {
    const result = testChunk(chunk, normalizedCS ?? '');
    if (result.matched) return result;
  }

  for (const entry of compiled.regexRules) {
    const candidate = entry.caseSensitive ? normalizedCS ?? normalize(text, true) : normalizedCI ?? normalize(text, false);
    const match = entry.regex.exec(candidate);
    if (match) return { matched: true, ruleId: entry.ruleId, matchedText: match[0] };
  }
  return { matched: false };
}
