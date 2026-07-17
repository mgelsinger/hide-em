import React, { useEffect, useMemo, useState } from 'react';
import type { StoredConfig } from '../../shared/types.js';
import { createDefaultConfig } from '../../shared/types.js';
import { hostnameMatches } from '../../shared/domains.js';
import {
  addExcludedDomain,
  addRule,
  deleteExcludedDomain,
  getConfig,
  onConfigChanged,
  updateSettings,
} from '../../shared/storage.js';

async function currentHostname(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    const url = new URL(tab.url);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function App() {
  const [config, setConfig] = useState<StoredConfig>(() => createDefaultConfig());
  const [hostname, setHostname] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [wholeWord, setWholeWord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([getConfig(), currentHostname().catch(() => null)])
      .then(([next, activeHostname]) => {
        if (!active) return;
        setConfig(next);
        setHostname(activeHostname);
        setReady(true);
        setStatus('');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus('');
      });
    const unsubscribe = onConfigChanged((next) => active && setConfig(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const matchingExclusion = useMemo(
    () => hostname ? config.excludedDomains.find((entry) => entry.enabled && hostnameMatches(hostname, entry.hostname)) : undefined,
    [config.excludedDomains, hostname],
  );

  async function run(operation: () => Promise<{ config: StoredConfig; message?: string }>): Promise<boolean> {
    setBusy(true);
    setError('');
    setStatus('Saving...');
    try {
      const result = await operation();
      setConfig(result.config);
      setStatus(result.message ?? 'Saved.');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('Save failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const saved = await run(() => addRule({
      type: 'keyword',
      value,
      aliases: [],
      caseSensitive: false,
      wholeWord,
    }));
    if (saved) setValue('');
  }

  async function toggleCurrentSite() {
    if (!hostname) return;
    if (matchingExclusion?.hostname === hostname) {
      await run(() => deleteExcludedDomain(matchingExclusion.id));
      return;
    }
    if (!matchingExclusion) await run(() => addExcludedDomain(hostname));
  }

  function openOptions() {
    void chrome.runtime.openOptionsPage();
    window.close();
  }

  return (
    <main>
      <header>
        <div>
          <h1>hide-em</h1>
          <p>{config.rules.length} rule{config.rules.length === 1 ? '' : 's'}</p>
        </div>
        <label className="switch-row">
          <span>Enabled</span>
          <input
            type="checkbox"
            checked={config.settings.enabled}
            disabled={busy || !ready}
            onChange={(event) => void run(() => updateSettings({ enabled: event.target.checked }))}
          />
        </label>
      </header>

      <section className="quick-add">
        <h2>Quick add</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="quick-value">Word or phrase to hide</label>
          <input
            id="quick-value"
            type="text"
            value={value}
            disabled={busy || !ready}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            placeholder="Enter a word or phrase"
          />
          <label className="check-row">
            <input type="checkbox" checked={wholeWord} disabled={busy || !ready} onChange={(event) => setWholeWord(event.target.checked)} />
            Match whole word only
          </label>
          <button type="submit" className="primary" disabled={busy || !ready || !value.trim()}>Add to blocklist</button>
        </form>
      </section>

      <section className="site-control">
        <div>
          <h2>Current site</h2>
          <p>{hostname ?? 'This browser page cannot be excluded.'}</p>
          {matchingExclusion && <small>Excluded by {matchingExclusion.hostname}</small>}
        </div>
        {hostname && (
          <button
            type="button"
            className="secondary"
            disabled={busy || !ready || Boolean(matchingExclusion && matchingExclusion.hostname !== hostname)}
            onClick={() => void toggleCurrentSite()}
          >
            {matchingExclusion?.hostname === hostname ? 'Scan this site' : matchingExclusion ? 'Managed by parent domain' : 'Exclude site'}
          </button>
        )}
      </section>

      {(status || error) && <p className={error ? 'message error' : 'message'} role={error ? 'alert' : 'status'}>{error || status}</p>}

      <footer>
        <button type="button" className="link-button" onClick={openOptions}>Manage rules and exclusions</button>
      </footer>
    </main>
  );
}
