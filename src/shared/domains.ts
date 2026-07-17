import type { ExcludedDomain } from './types.js';

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export function normalizeHostnameInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a domain.');
  if (trimmed.includes('*')) throw new Error('Wildcards are not needed; subdomains are included automatically.');

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('Enter a valid domain or web address.');
  }

  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    throw new Error('Only http and https sites can be excluded.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!hostname || hostname === 'localhost' || !hostname.includes('.')) {
    throw new Error('Enter a complete domain such as twitch.tv.');
  }
  return hostname;
}

export function hostnameMatches(hostname: string, excludedHostname: string): boolean {
  const candidate = hostname.toLowerCase().replace(/\.$/, '');
  const excluded = excludedHostname.toLowerCase().replace(/\.$/, '');
  return candidate === excluded || candidate.endsWith(`.${excluded}`);
}

export function isHostnameExcluded(hostname: string, exclusions: ExcludedDomain[]): boolean {
  return exclusions.some((entry) => entry.enabled && hostnameMatches(hostname, entry.hostname));
}
