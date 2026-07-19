import React, { useEffect, useMemo, useState } from 'react';
import type { PopupPageStatus } from '../../shared/page-control.js';
import {
  getPageStatus,
  pauseSite,
  pauseTab,
  resumeSite,
  resumeTab,
} from '../../shared/page-control-client.js';
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

type ActivePage = { tabId: number; hostname: string };
type PauseChoice = 'tab' | 'site_ten_minutes' | 'site_session';

async function currentPage(): Promise<ActivePage | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? { tabId: tab.id, hostname: url.hostname.toLowerCase() }
      : null;
  } catch {
    return null;
  }
}

function statusLabel(pageStatus: PopupPageStatus | null): string {
  if (!pageStatus) return 'Loading';
  if (!pageStatus.available) return 'Unavailable';
  switch (pageStatus.state) {
    case 'active': return 'Filtering active';
    case 'global_disabled': return 'Extension paused';
    case 'excluded': return 'Permanently excluded';
    case 'tab_paused': return 'Tab paused';
    case 'site_paused': return 'Site paused';
    case 'safety_stopped': return 'Safety stop';
    case 'loading': return 'Starting';
  }
}

function pauseDescription(pageStatus: PopupPageStatus): string | null {
  if (!pageStatus.available || !pageStatus.sitePause) return null;
  if (pageStatus.sitePause.expiresAt === null) return `Paused for this browser session by ${pageStatus.sitePause.hostname}.`;
  const minutes = Math.max(1, Math.ceil((pageStatus.sitePause.expiresAt - Date.now()) / 60_000));
  return `Paused by ${pageStatus.sitePause.hostname} for about ${minutes} more minute${minutes === 1 ? '' : 's'}.`;
}

export function App() {
  const [config, setConfig] = useState<StoredConfig>(() => createDefaultConfig());
  const [activePage, setActivePage] = useState<ActivePage | null>(null);
  const [pageStatus, setPageStatus] = useState<PopupPageStatus | null>(null);
  const [value, setValue] = useState('');
  const [wholeWord, setWholeWord] = useState(false);
  const [pauseChoice, setPauseChoice] = useState<PauseChoice>('tab');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');

  async function refreshPageStatus(page = activePage): Promise<void> {
    if (!page) {
      setPageStatus({ available: false, hostname: null, reason: 'This browser page cannot be filtered or paused.' });
      return;
    }
    setPageStatus(await getPageStatus(page.tabId, page.hostname));
  }

  useEffect(() => {
    let active = true;
    void Promise.all([getConfig(), currentPage()])
      .then(async ([next, page]) => {
        if (!active) return;
        setConfig(next);
        setActivePage(page);
        if (page) setPageStatus(await getPageStatus(page.tabId, page.hostname));
        else setPageStatus({ available: false, hostname: null, reason: 'This browser page cannot be filtered or paused.' });
        if (!active) return;
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

  useEffect(() => {
    if (!activePage) return undefined;
    let active = true;
    const interval = window.setInterval(() => {
      void getPageStatus(activePage.tabId, activePage.hostname).then((next) => {
        if (active) setPageStatus(next);
      });
    }, 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activePage]);

  const matchingExclusion = useMemo(
    () => activePage
      ? config.excludedDomains.find((entry) => entry.enabled && hostnameMatches(activePage.hostname, entry.hostname))
      : undefined,
    [activePage, config.excludedDomains],
  );

  async function runConfig(operation: () => Promise<{ config: StoredConfig; message?: string }>): Promise<boolean> {
    setBusy(true);
    setError('');
    setStatus('Saving...');
    try {
      const result = await operation();
      setConfig(result.config);
      setStatus(result.message ?? 'Saved.');
      window.setTimeout(() => void refreshPageStatus(), 50);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('Save failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runPageControl(operation: () => Promise<{ message?: string }>): Promise<void> {
    setBusy(true);
    setError('');
    setStatus('Applying...');
    try {
      const result = await operation();
      await refreshPageStatus();
      setStatus(result.message ?? 'Applied.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('Could not update this page.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const saved = await runConfig(() => addRule({
      type: 'keyword', value, aliases: [], caseSensitive: false, wholeWord,
    }));
    if (saved) setValue('');
  }

  async function applyPause() {
    if (!activePage) return;
    if (pauseChoice === 'tab') {
      await runPageControl(() => pauseTab(activePage.hostname, activePage.tabId));
    } else {
      await runPageControl(() => pauseSite(
        activePage.hostname,
        pauseChoice === 'site_ten_minutes' ? 'ten_minutes' : 'session',
        activePage.tabId,
      ));
    }
  }

  async function togglePersistentExclusion() {
    if (!activePage) return;
    if (matchingExclusion?.hostname === activePage.hostname) {
      await runConfig(() => deleteExcludedDomain(matchingExclusion.id));
    } else if (!matchingExclusion) {
      await runConfig(() => addExcludedDomain(activePage.hostname));
    }
  }

  function openOptions() {
    void chrome.runtime.openOptionsPage();
    window.close();
  }

  const availableStatus = pageStatus?.available ? pageStatus : null;
  const canTemporarilyPause = Boolean(
    activePage && availableStatus
    && !['global_disabled', 'excluded', 'safety_stopped', 'loading'].includes(availableStatus.state),
  );

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
            onChange={(event) => void runConfig(() => updateSettings({ enabled: event.target.checked }))}
          />
        </label>
      </header>

      <section className="page-control">
        <div className="section-heading">
          <div>
            <h2>Current page</h2>
            <p className="hostname">{activePage?.hostname ?? 'Browser page'}</p>
          </div>
          <span className={`state-pill state-${availableStatus?.state ?? 'unavailable'}`}>{statusLabel(pageStatus)}</span>
        </div>

        {availableStatus ? (
          <>
            <div className="hidden-summary">
              <strong>{availableStatus.hiddenCount}</strong>
              <span>item{availableStatus.hiddenCount === 1 ? '' : 's'} currently hidden</span>
            </div>
            {pauseDescription(availableStatus) && <p className="control-note">{pauseDescription(availableStatus)}</p>}
            {availableStatus.state === 'safety_stopped' && <p className="control-note warning">Reload this page to retry filtering.</p>}

            <div className="control-actions">
              {availableStatus.state === 'active' && availableStatus.hiddenCount > 0 && activePage && (
                <button className="primary" disabled={busy} onClick={() => void runPageControl(() => pauseTab(activePage.hostname, activePage.tabId))}>
                  Show all and pause tab
                </button>
              )}
              {availableStatus.tabPaused && activePage && (
                <button className="secondary" disabled={busy} onClick={() => void runPageControl(() => resumeTab(activePage.hostname, activePage.tabId))}>
                  Resume tab
                </button>
              )}
              {availableStatus.sitePause && activePage && (
                <button className="secondary" disabled={busy} onClick={() => void runPageControl(() => resumeSite(availableStatus.sitePause!.hostname, activePage.tabId))}>
                  Resume site
                </button>
              )}
            </div>

            {canTemporarilyPause && !availableStatus.tabPaused && !availableStatus.sitePause && (
              <div className="pause-picker">
                <label htmlFor="pause-choice">Temporary pause</label>
                <div>
                  <select id="pause-choice" value={pauseChoice} disabled={busy} onChange={(event) => setPauseChoice(event.target.value as PauseChoice)}>
                    <option value="tab">This tab until closed</option>
                    <option value="site_ten_minutes">This hostname for 10 minutes</option>
                    <option value="site_session">This hostname until restart</option>
                  </select>
                  <button className="secondary" disabled={busy} onClick={() => void applyPause()}>Pause</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="control-note">
            {pageStatus && !pageStatus.available ? pageStatus.reason : 'Checking page scanner...'}
          </p>
        )}

        {activePage && (
          <div className="persistent-control">
            <span>{matchingExclusion ? `Excluded by ${matchingExclusion.hostname}` : 'Permanent site exclusion'}</span>
            <button
              className="link-button compact-link"
              disabled={busy || Boolean(matchingExclusion && matchingExclusion.hostname !== activePage.hostname)}
              onClick={() => void togglePersistentExclusion()}
            >
              {matchingExclusion?.hostname === activePage.hostname ? 'Remove exclusion' : matchingExclusion ? 'Managed by parent domain' : 'Exclude hostname'}
            </button>
          </div>
        )}
      </section>

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

      {(status || error) && <p className={error ? 'message error' : 'message'} role={error ? 'alert' : 'status'}>{error || status}</p>}

      <footer>
        <button type="button" className="link-button" onClick={openOptions}>Manage rules and exclusions</button>
      </footer>
    </main>
  );
}
