import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockRule, Settings } from '../../shared/types.js';
import { DEFAULT_SETTINGS } from '../../shared/types.js';
import { getRules, getSettings, onRulesChanged, onSettingsChanged, setRules, setSettings } from '../../shared/storage.js';
import { RuleList } from './components/RuleList.js';
import { RuleForm } from './components/RuleForm.js';
import { Settings as SettingsPanel } from './components/Settings.js';

type FormState = { open: false } | { open: true; editing: BlockRule | null };

export function App() {
  const [rules, setLocalRules] = useState<BlockRule[]>([]);
  const [settings, setLocalSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [form, setForm] = useState<FormState>({ open: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getRules().then(setLocalRules);
    void getSettings().then(setLocalSettings);
    const unsubRules = onRulesChanged(setLocalRules);
    const unsubSettings = onSettingsChanged(setLocalSettings);
    return () => { unsubRules(); unsubSettings(); };
  }, []);

  const saveRules = useCallback(async (next: BlockRule[]) => {
    setLocalRules(next);
    await setRules(next);
  }, []);

  const saveSettings = useCallback(async (next: Settings) => {
    setLocalSettings(next);
    await setSettings(next);
  }, []);

  function openAdd() { setForm({ open: true, editing: null }); }
  function openEdit(rule: BlockRule) { setForm({ open: true, editing: rule }); }
  function closeForm() { setForm({ open: false }); }

  async function handleSave(rule: BlockRule) {
    const editing = form.open ? form.editing : null;
    const next = editing
      ? rules.map((r) => (r.id === rule.id ? rule : r))
      : [...rules, rule];
    await saveRules(next);
    closeForm();
  }

  async function handleDelete(id: string) {
    await saveRules(rules.filter((r) => r.id !== id));
  }

  async function handleToggle(id: string, enabled: boolean) {
    await saveRules(rules.map((r) => (r.id === id ? { ...r, enabled } : r)));
  }

  function handleExport() {
    const blob = new Blob(
      [JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), rules }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hide-em-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    setImportError('');
    fileRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      let imported: BlockRule[];
      if (Array.isArray(data)) {
        imported = data as BlockRule[];
      } else if (data && typeof data === 'object' && 'rules' in data && Array.isArray((data as { rules: unknown }).rules)) {
        imported = (data as { rules: BlockRule[] }).rules;
      } else {
        throw new Error('Unrecognized format');
      }
      if (imported.length === 0) { setImportError('File contains no rules.'); return; }
      const merged = mergeRules(rules, imported);
      await saveRules(merged);
      setImportError('');
    } catch (err) {
      setImportError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const editingRule = form.open ? form.editing : null;

  return (
    <div>
      <header className="page-header">
        <h1>hide-em</h1>
        <span className="tagline">Personal attention filter</span>
      </header>

      {/* Settings */}
      <div className="card">
        <div
          className={`card-header${settingsOpen ? ' open' : ''}`}
          onClick={() => setSettingsOpen((o) => !o)}
          role="button"
          aria-expanded={settingsOpen}
        >
          <h2>Settings</h2>
          <span className="chevron">▼</span>
        </div>
        {settingsOpen && (
          <div className="card-body">
            <SettingsPanel settings={settings} onChange={(s) => void saveSettings(s)} />
          </div>
        )}
      </div>

      {/* Blocklist */}
      <div className="card">
        <div className="card-header" style={{ cursor: 'default' }}>
          <h2>Blocklist</h2>
          <span className="rule-count">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={openAdd} disabled={form.open && editingRule === null}>
              + Add rule
            </button>
            <div className="import-export">
              <button className="btn btn-secondary" onClick={handleImportClick}>↑ Import</button>
              <button className="btn btn-secondary" onClick={handleExport} disabled={rules.length === 0}>↓ Export</button>
            </div>
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleFileChange} />
          </div>
          {importError && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#dc2626' }}>{importError}</p>}
        </div>

        {form.open && (
          <RuleForm
            initial={editingRule}
            onSave={(r) => void handleSave(r)}
            onCancel={closeForm}
          />
        )}

        <RuleList
          rules={rules}
          onEdit={openEdit}
          onDelete={(id) => void handleDelete(id)}
          onToggle={(id, v) => void handleToggle(id, v)}
        />
      </div>
    </div>
  );
}

function mergeRules(existing: BlockRule[], imported: BlockRule[]): BlockRule[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const r of imported) {
    byId.set(r.id, r);
  }
  return Array.from(byId.values());
}
