import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRule, RuleDraft, RuleType, StoredConfig } from '../../shared/types.js';
import { createDefaultConfig } from '../../shared/types.js';
import {
  addExcludedDomain,
  addRule,
  applyImport,
  createExportBundle,
  deleteExcludedDomain,
  deleteRule,
  getConfig,
  onConfigChanged,
  setExcludedDomainEnabled,
  setRuleEnabled,
  updateRule,
  updateSettings,
} from '../../shared/storage.js';
import { parseImport } from '../../shared/validation.js';
import { RuleList } from './components/RuleList.js';
import { RuleForm } from './components/RuleForm.js';
import { Settings as SettingsPanel } from './components/Settings.js';
import { ExcludedDomains } from './components/ExcludedDomains.js';
import { filterRules } from './rule-filter.js';
import type { RuleStateFilter, RuleTypeFilter } from './rule-filter.js';

type FormState = { open: false } | { open: true; editing: BlockRule | null };
type ImportPreview = {
  data: unknown;
  rules: number;
  domains: number;
  warnings: string[];
};

export function App() {
  const [config, setConfig] = useState<StoredConfig>(() => createDefaultConfig());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>({ open: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [ruleQuery, setRuleQuery] = useState('');
  const [ruleType, setRuleType] = useState<RuleTypeFilter>('all');
  const [ruleState, setRuleState] = useState<RuleStateFilter>('all');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void getConfig()
      .then((next) => {
        if (!active) return;
        setConfig(next);
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    const unsubscribe = onConfigChanged((next) => {
      if (!active) return;
      setConfig(next);
      setLoaded(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const runMutation = useCallback(async (
    operation: () => Promise<{ config: StoredConfig; message?: string }>,
  ): Promise<boolean> => {
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
      setStatus('Save failed. Your previous configuration is still active.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  function openAdd() { setForm({ open: true, editing: null }); }
  function openEdit(rule: BlockRule) { setForm({ open: true, editing: rule }); }
  function closeForm() { setForm({ open: false }); }

  async function handleSave(draft: RuleDraft) {
    const editing = form.open ? form.editing : null;
    const saved = editing
      ? await runMutation(() => updateRule({ ...editing, ...draft }))
      : await runMutation(() => addRule(draft));
    if (saved) closeForm();
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(createExportBundle(config), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hide-em-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Export created.');
  }

  function handleImportClick() {
    setError('');
    setImportPreview(null);
    fileRef.current?.click();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    try {
      if (file.size > 5_000_000) throw new Error('The selected file is too large. JSON imports are limited to 5 MB.');
      const data = JSON.parse(await file.text()) as unknown;
      const parsed = parseImport(data);
      if (!parsed.ok) throw new Error(parsed.errors.join(' '));
      setImportPreview({
        data,
        rules: parsed.value.rules.length,
        domains: parsed.value.excludedDomains.length,
        warnings: parsed.warnings,
      });
    } catch (reason) {
      setError(`Import failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  async function confirmImport(mode: 'merge' | 'replace') {
    if (!importPreview) return;
    const saved = await runMutation(() => applyImport(importPreview.data, mode));
    if (saved) setImportPreview(null);
  }

  const editingRule = form.open ? form.editing : null;
  const filteredRules = useMemo(() => filterRules(config.rules, {
    query: ruleQuery,
    type: ruleType,
    state: ruleState,
  }), [config.rules, ruleQuery, ruleState, ruleType]);
  const filtersActive = Boolean(ruleQuery.trim() || ruleType !== 'all' || ruleState !== 'all');

  return (
    <main>
      <header className="page-header">
        <div>
          <h1>hide-em</h1>
          <p className="tagline">Personal attention filter</p>
        </div>
        <span className={`save-indicator${busy ? ' saving' : ''}`} aria-live="polite">
          {loaded ? status : 'Loading...'}
        </span>
      </header>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <section className="card">
        <button
          type="button"
          className={`card-header card-header-button${settingsOpen ? ' open' : ''}`}
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
        >
          <h2>Settings</h2>
          <span className="chevron" aria-hidden="true">v</span>
        </button>
        {settingsOpen && (
          <div className="card-body">
            <SettingsPanel
              settings={config.settings}
              disabled={busy || !loaded}
              onChange={(patch) => void runMutation(() => updateSettings(patch))}
            />
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header static">
          <h2>Blocklist</h2>
          <span className="rule-count">{config.rules.length} rule{config.rules.length === 1 ? '' : 's'}</span>
        </div>

        <div className="card-body toolbar-body">
          <div className="toolbar">
            <button className="btn btn-primary" onClick={openAdd} disabled={busy || !loaded || (form.open && editingRule === null)}>
              Add rule
            </button>
            <div className="import-export">
              <button className="btn btn-secondary" onClick={handleImportClick} disabled={busy || !loaded}>Import JSON</button>
              <button className="btn btn-secondary" onClick={handleExport} disabled={busy || !loaded}>Export JSON</button>
            </div>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(event) => void handleFileChange(event)} />
          </div>

          <div className="rule-filters" role="search" aria-label="Filter blocklist rules">
            <div className="filter-search">
              <label className="sr-only" htmlFor="rule-search">Search rules and aliases</label>
              <input
                id="rule-search"
                type="search"
                value={ruleQuery}
                onChange={(event) => setRuleQuery(event.target.value)}
                placeholder="Search rules and aliases"
                disabled={!loaded}
              />
            </div>
            <label>
              <span className="sr-only">Rule type</span>
              <select value={ruleType} disabled={!loaded} onChange={(event) => setRuleType(event.target.value as RuleTypeFilter)}>
                <option value="all">All types</option>
                {(['keyword', 'creator', 'phrase', 'regex'] as RuleType[]).map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Rule state</span>
              <select value={ruleState} disabled={!loaded} onChange={(event) => setRuleState(event.target.value as RuleStateFilter)}>
                <option value="all">All states</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            {filtersActive && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setRuleQuery(''); setRuleType('all'); setRuleState('all'); }}
              >
                Clear filters
              </button>
            )}
          </div>
          <p className="filter-count" aria-live="polite">
            Showing {filteredRules.length} of {config.rules.length} rule{config.rules.length === 1 ? '' : 's'}
          </p>

          {importPreview && (
            <div className="import-preview" role="status">
              <p>Ready to import {importPreview.rules} rule{importPreview.rules === 1 ? '' : 's'} and {importPreview.domains} excluded domain{importPreview.domains === 1 ? '' : 's'}.</p>
              {importPreview.warnings.map((warning, index) => <p key={`${index}-${warning}`} className="field-warning">{warning}</p>)}
              <div className="form-actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => void confirmImport('merge')}>Merge</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => void confirmImport('replace')}>Replace everything</button>
                <button className="btn btn-secondary" disabled={busy} onClick={() => setImportPreview(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {form.open && (
          <RuleForm
            initial={editingRule}
            disabled={busy || !loaded}
            onSave={handleSave}
            onCancel={closeForm}
          />
        )}

        <RuleList
          rules={filteredRules}
          emptyMessage={config.rules.length === 0
            ? 'No rules yet. Add one above to get started.'
            : 'No rules match the current search and filters.'}
          disabled={busy || !loaded}
          onEdit={openEdit}
          onDelete={(id) => void runMutation(() => deleteRule(id))}
          onToggle={(id, enabled) => void runMutation(() => setRuleEnabled(id, enabled))}
        />
      </section>

      <section className="card">
        <div className="card-header static">
          <div>
            <h2>Excluded sites</h2>
            <p className="section-help">hide-em will not scan these domains or their subdomains.</p>
          </div>
          <span className="rule-count">{config.excludedDomains.length}</span>
        </div>
        <ExcludedDomains
          domains={config.excludedDomains}
          disabled={busy || !loaded}
          onAdd={(input) => runMutation(() => addExcludedDomain(input))}
          onDelete={(id) => void runMutation(() => deleteExcludedDomain(id))}
          onToggle={(id, enabled) => void runMutation(() => setExcludedDomainEnabled(id, enabled))}
        />
      </section>
    </main>
  );
}
