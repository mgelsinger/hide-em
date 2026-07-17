import { normalizeHostnameInput } from './domains.js';
import {
  MAX_PROCESSED_REQUEST_IDS,
} from './types.js';
import type {
  BlockRule,
  ExcludedDomain,
  StoredConfig,
} from './types.js';
import type { ConfigCommand } from './protocol.js';
import {
  createId,
  parseImport,
  ruleSignature,
  validateRule,
  validateRuleDraft,
} from './validation.js';

export type MutationResult = {
  config: StoredConfig;
  message?: string;
};

function cloneConfig(config: StoredConfig): StoredConfig {
  return {
    ...config,
    rules: config.rules.map((rule) => ({ ...rule, aliases: [...rule.aliases] })),
    settings: { ...config.settings },
    excludedDomains: config.excludedDomains.map((domain) => ({ ...domain })),
    processedRequestIds: [...config.processedRequestIds],
  };
}

function mutationRequestId(command: ConfigCommand): string | null {
  return command.type === 'config.get' ? null : command.requestId;
}

function markProcessed(config: StoredConfig, requestId: string): void {
  config.processedRequestIds = [
    ...config.processedRequestIds.filter((id) => id !== requestId),
    requestId,
  ].slice(-MAX_PROCESSED_REQUEST_IDS);
  config.updatedAt = Date.now();
}

function findRule(config: StoredConfig, id: string): BlockRule {
  const rule = config.rules.find((candidate) => candidate.id === id);
  if (!rule) throw new Error('Rule no longer exists. Refresh and try again.');
  return rule;
}

function findExclusion(config: StoredConfig, id: string): ExcludedDomain {
  const exclusion = config.excludedDomains.find((candidate) => candidate.id === id);
  if (!exclusion) throw new Error('Excluded domain no longer exists. Refresh and try again.');
  return exclusion;
}

export function applyConfigCommand(current: StoredConfig, command: ConfigCommand): MutationResult {
  if (command.type === 'config.get') return { config: current };
  if (current.processedRequestIds.includes(command.requestId)) {
    return { config: current, message: 'This change was already saved.' };
  }

  const config = cloneConfig(current);
  let message: string | undefined;

  switch (command.type) {
    case 'rule.add': {
      const result = validateRuleDraft(command.draft);
      if (!result.ok) throw new Error(result.errors.join(' '));
      const signature = ruleSignature(result.value);
      const existing = config.rules.find((rule) => ruleSignature(rule) === signature);
      if (existing) {
        const wasEnabled = existing.enabled;
        existing.enabled = true;
        existing.updatedAt = Date.now();
        message = wasEnabled ? 'That rule already exists.' : 'The existing rule is enabled.';
        break;
      }
      const now = Date.now();
      config.rules.push({
        id: createId(),
        ...result.value,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      message = 'Rule saved.';
      break;
    }
    case 'rule.update': {
      const existing = findRule(config, command.rule.id);
      const result = validateRule({
        ...command.rule,
        enabled: existing.enabled,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      });
      if (!result.ok) throw new Error(result.errors.join(' '));
      const signature = ruleSignature(result.value);
      if (config.rules.some((rule) => rule.id !== result.value.id && ruleSignature(rule) === signature)) {
        throw new Error('An equivalent rule already exists.');
      }
      config.rules = config.rules.map((rule) => rule.id === result.value.id ? result.value : rule);
      message = 'Rule updated.';
      break;
    }
    case 'rule.delete':
      findRule(config, command.id);
      config.rules = config.rules.filter((rule) => rule.id !== command.id);
      message = 'Rule deleted.';
      break;
    case 'rule.setEnabled': {
      const rule = findRule(config, command.id);
      rule.enabled = command.enabled;
      rule.updatedAt = Date.now();
      message = command.enabled ? 'Rule enabled.' : 'Rule disabled.';
      break;
    }
    case 'settings.update':
      config.settings = {
        enabled: typeof command.patch.enabled === 'boolean' ? command.patch.enabled : config.settings.enabled,
        debug: typeof command.patch.debug === 'boolean' ? command.patch.debug : config.settings.debug,
      };
      message = 'Settings saved.';
      break;
    case 'exclusion.add': {
      const hostname = normalizeHostnameInput(command.input);
      const existing = config.excludedDomains.find((entry) => entry.hostname === hostname);
      if (existing) {
        existing.enabled = true;
        message = 'The existing domain exclusion is enabled.';
        break;
      }
      config.excludedDomains.push({ id: createId(), hostname, enabled: true, createdAt: Date.now() });
      message = `${hostname} is now excluded.`;
      break;
    }
    case 'exclusion.delete':
      findExclusion(config, command.id);
      config.excludedDomains = config.excludedDomains.filter((entry) => entry.id !== command.id);
      message = 'Domain exclusion deleted.';
      break;
    case 'exclusion.setEnabled': {
      const exclusion = findExclusion(config, command.id);
      exclusion.enabled = command.enabled;
      message = command.enabled ? 'Domain exclusion enabled.' : 'Domain exclusion disabled.';
      break;
    }
    case 'import.apply': {
      const imported = parseImport(command.data);
      if (!imported.ok) throw new Error(imported.errors.join(' '));
      if (command.mode === 'replace') {
        config.rules = imported.value.rules;
        config.settings = imported.value.settings;
        config.excludedDomains = imported.value.excludedDomains;
      } else {
        const signatures = new Set(config.rules.map(ruleSignature));
        for (const rule of imported.value.rules) {
          const signature = ruleSignature(rule);
          if (signatures.has(signature)) continue;
          if (config.rules.some((existing) => existing.id === rule.id)) rule.id = createId();
          signatures.add(signature);
          config.rules.push(rule);
        }
        const hostnames = new Set(config.excludedDomains.map((entry) => entry.hostname));
        for (const exclusion of imported.value.excludedDomains) {
          if (hostnames.has(exclusion.hostname)) continue;
          if (config.excludedDomains.some((existing) => existing.id === exclusion.id)) exclusion.id = createId();
          hostnames.add(exclusion.hostname);
          config.excludedDomains.push(exclusion);
        }
      }
      message = `Imported ${imported.value.rules.length} rules and ${imported.value.excludedDomains.length} excluded domains.`;
      break;
    }
  }

  const requestId = mutationRequestId(command);
  if (requestId) markProcessed(config, requestId);
  return { config, message };
}
