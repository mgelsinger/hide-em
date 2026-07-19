import type { BlockRule, RuleType } from '../../shared/types.js';
import { normalize } from '../../engine/normalize.js';

export type RuleTypeFilter = 'all' | RuleType;
export type RuleStateFilter = 'all' | 'enabled' | 'disabled';

export type RuleFilters = {
  query: string;
  type: RuleTypeFilter;
  state: RuleStateFilter;
};

function searchable(value: string): string {
  return normalize(value, false);
}

export function filterRules(rules: BlockRule[], filters: RuleFilters): BlockRule[] {
  const query = searchable(filters.query.trim());
  return rules.filter((rule) => {
    if (filters.type !== 'all' && rule.type !== filters.type) return false;
    if (filters.state === 'enabled' && !rule.enabled) return false;
    if (filters.state === 'disabled' && rule.enabled) return false;
    if (!query) return true;
    return [rule.value, ...rule.aliases, rule.type].some((value) => searchable(value).includes(query));
  });
}
