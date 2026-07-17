import { describe, expect, it } from 'vitest';
import { hostnameMatches, isHostnameExcluded, normalizeHostnameInput } from './domains.js';

describe('domain exclusions', () => {
  it('normalizes domains and full web addresses', () => {
    expect(normalizeHostnameInput(' Twitch.TV ')).toBe('twitch.tv');
    expect(normalizeHostnameInput('https://WWW.Example.com/path?q=1')).toBe('www.example.com');
  });

  it('rejects wildcard, local, and non-web inputs', () => {
    expect(() => normalizeHostnameInput('*.example.com')).toThrow(/Wildcards/);
    expect(() => normalizeHostnameInput('localhost')).toThrow(/complete domain/);
    expect(() => normalizeHostnameInput('chrome://settings')).toThrow(/http and https/);
  });

  it('matches exact domains and their subdomains only', () => {
    expect(hostnameMatches('twitch.tv', 'twitch.tv')).toBe(true);
    expect(hostnameMatches('chat.twitch.tv', 'twitch.tv')).toBe(true);
    expect(hostnameMatches('nottwitch.tv', 'twitch.tv')).toBe(false);
  });

  it('ignores disabled exclusions', () => {
    expect(isHostnameExcluded('chat.twitch.tv', [
      { id: 'one', hostname: 'twitch.tv', enabled: false, createdAt: 1 },
    ])).toBe(false);
  });
});
