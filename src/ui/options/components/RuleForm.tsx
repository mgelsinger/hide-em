import React, { useEffect, useState } from 'react';
import type { BlockRule, HideAction, Platform, RuleScope, RuleType } from '../../../shared/types.js';
import { PLATFORMS } from '../../../shared/types.js';

interface Props {
  initial: BlockRule | null;
  onSave: (rule: BlockRule) => void;
  onCancel: () => void;
}

const DEFAULT_SCOPE: RuleScope = { titles: true, channels: true, comments: false, descriptions: false };
const SCOPE_KEYS: (keyof RuleScope)[] = ['titles', 'channels', 'comments', 'descriptions'];
const RULE_TYPES: RuleType[] = ['keyword', 'creator', 'phrase', 'regex'];
const ACTIONS: HideAction[] = ['hide', 'collapse', 'blur'];

function blankForm(): Partial<BlockRule> {
  return {
    type: 'keyword',
    value: '',
    aliases: [],
    wholeWord: false,
    caseSensitive: false,
    scope: { ...DEFAULT_SCOPE },
    action: 'hide',
    platforms: 'all',
    enabled: true,
  };
}

export function RuleForm({ initial, onSave, onCancel }: Props) {
  const [form, setForm] = useState<Partial<BlockRule>>(() =>
    initial ? { ...initial } : blankForm(),
  );
  const [aliasText, setAliasText] = useState(() =>
    initial ? initial.aliases.join(', ') : '',
  );
  const [valueError, setValueError] = useState('');

  useEffect(() => {
    setForm(initial ? { ...initial } : blankForm());
    setAliasText(initial ? initial.aliases.join(', ') : '');
    setValueError('');
  }, [initial]);

  function set<K extends keyof BlockRule>(key: K, val: BlockRule[K]) {
    setForm((f) => {
      const next = { ...f, [key]: val };
      if (key === 'type') {
        next.wholeWord = val === 'creator';
      }
      return next;
    });
  }

  function setScope(key: keyof RuleScope, val: boolean) {
    setForm((f) => ({ ...f, scope: { ...(f.scope ?? DEFAULT_SCOPE), [key]: val } }));
  }

  function togglePlatform(p: Platform) {
    const current = form.platforms;
    if (current === 'all') {
      setForm((f) => ({ ...f, platforms: PLATFORMS.filter((x) => x !== p) }));
    } else {
      const arr = current as Platform[];
      const next = arr.includes(p) ? arr.filter((x) => x !== p) : [...arr, p];
      setForm((f) => ({ ...f, platforms: next.length === PLATFORMS.length ? 'all' : next }));
    }
  }

  const isAllPlatforms = form.platforms === 'all';

  const value = (form.value ?? '').trim();
  const isShortAndSubstring = value.length > 0 && value.length < 4 && !form.wholeWord;
  const isRegex = form.type === 'regex';

  function validate(): boolean {
    if (!value) { setValueError('Value is required.'); return false; }
    if (isRegex) {
      try { new RegExp(value); }
      catch { setValueError('Invalid regular expression.'); return false; }
    }
    setValueError('');
    return true;
  }

  function handleSave() {
    if (!validate()) return;
    const rule: BlockRule = {
      id: initial?.id ?? crypto.randomUUID(),
      type: (form.type ?? 'keyword') as RuleType,
      value,
      aliases: aliasText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      enabled: form.enabled ?? true,
      caseSensitive: form.caseSensitive ?? false,
      wholeWord: form.wholeWord ?? false,
      platforms: form.platforms ?? 'all',
      scope: form.scope ?? { ...DEFAULT_SCOPE },
      action: (form.action ?? 'hide') as HideAction,
      hits: initial?.hits ?? 0,
      createdAt: initial?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    onSave(rule);
  }

  return (
    <div className="rule-form">
      <p className="form-title">{initial ? 'Edit rule' : 'Add rule'}</p>
      <div className="form-grid">
        {/* Value */}
        <div className="form-field span2">
          <label htmlFor="rf-value">Value {isRegex && <span style={{ color: '#9d174d', fontWeight: 400 }}>(regex pattern)</span>}</label>
          <input
            id="rf-value"
            type="text"
            value={form.value ?? ''}
            onChange={(e) => { set('value', e.target.value); setValueError(''); }}
            className={valueError ? 'error' : ''}
            placeholder={isRegex ? 'e.g. ep\\.?\\s*\\d+' : 'e.g. Kim Kardashian'}
            autoFocus
          />
          {valueError && <span className="field-error">{valueError}</span>}
          {isShortAndSubstring && !valueError && (
            <span className="field-warning">⚠ Short rule with no word boundary — may hide many unrelated results.</span>
          )}
        </div>

        {/* Type */}
        <div className="form-field">
          <label htmlFor="rf-type">Type</label>
          <select id="rf-type" value={form.type ?? 'keyword'} onChange={(e) => set('type', e.target.value as RuleType)}>
            {RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Action */}
        <div className="form-field">
          <label htmlFor="rf-action">Action</label>
          <select id="rf-action" value={form.action ?? 'hide'} onChange={(e) => set('action', e.target.value as HideAction)}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {/* Aliases */}
        <div className="form-field span2">
          <label htmlFor="rf-aliases">Aliases <span style={{ fontWeight: 400, color: '#9ca3af' }}>(comma-separated, optional)</span></label>
          <input
            id="rf-aliases"
            type="text"
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            placeholder="e.g. @KimK, Kimberly Kardashian"
          />
        </div>

        {/* Scope */}
        <div className="form-field span2">
          <label>Match in</label>
          <div className="checkbox-group">
            {SCOPE_KEYS.map((k) => (
              <label key={k} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.scope?.[k] ?? DEFAULT_SCOPE[k]}
                  onChange={(e) => setScope(k, e.target.checked)}
                />
                {k}
              </label>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="form-field span2">
          <label>Options</label>
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.wholeWord ?? false}
                onChange={(e) => set('wholeWord', e.target.checked)}
                disabled={isRegex}
              />
              Whole word
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.caseSensitive ?? false}
                onChange={(e) => set('caseSensitive', e.target.checked)}
              />
              Case sensitive
            </label>
          </div>
        </div>

        {/* Platforms */}
        <div className="form-field span2">
          <label>Platforms</label>
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isAllPlatforms}
                onChange={(e) => set('platforms', e.target.checked ? 'all' : [])}
              />
              All platforms
            </label>
            {!isAllPlatforms &&
              PLATFORMS.map((p) => (
                <label key={p} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={(form.platforms as Platform[]).includes(p)}
                    onChange={() => togglePlatform(p)}
                  />
                  {p}
                </label>
              ))}
          </div>
        </div>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          {initial ? 'Save changes' : 'Add rule'}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
