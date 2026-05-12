import type {
  Platform,
  RuleType,
  HideAction,
  RuleScope,
  BlockRule,
  CompiledRuleset,
  MatchResult,
} from '../engine/matcher.js';

export type {
  Platform,
  RuleType,
  HideAction,
  RuleScope,
  BlockRule,
  CompiledRuleset,
  MatchResult,
};

export const PLATFORMS: Platform[] = ['youtube', 'twitter', 'reddit', 'twitch', 'tiktok'];

export type Settings = {
  enabled: boolean;
  defaultAction: HideAction;
  debug: boolean;
  perPlatformEnabled: Record<Platform, boolean>;
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  defaultAction: 'hide',
  debug: false,
  perPlatformEnabled: {
    youtube: true,
    twitter: true,
    reddit: true,
    twitch: true,
    tiktok: true,
  },
};

export type StorageLocal = {
  hits: Record<string, number>;
  overrides: Array<{ url: string; until: number }>;
  lastImport: { at: number; ruleCount: number } | null;
};

export const SCHEMA_VERSION = 1;
