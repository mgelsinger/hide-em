import { describe, expect, it } from 'vitest';
import { isConfigCommand } from './protocol.js';

describe('message validation', () => {
  it('accepts complete commands', () => {
    expect(isConfigCommand({ type: 'config.get' })).toBe(true);
    expect(isConfigCommand({ type: 'rule.delete', requestId: 'request', id: 'rule' })).toBe(true);
  });

  it('rejects malformed mutation commands', () => {
    expect(isConfigCommand({ type: 'rule.delete', id: 'rule' })).toBe(false);
    expect(isConfigCommand({ type: 'rule.setEnabled', requestId: 'request', id: 'rule', enabled: 'yes' })).toBe(false);
    expect(isConfigCommand({ type: 'import.apply', requestId: 'request', mode: 'unknown' })).toBe(false);
  });
});
