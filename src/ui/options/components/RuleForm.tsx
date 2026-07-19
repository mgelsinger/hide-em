import React, { useEffect, useMemo, useState } from 'react';
import type { BlockRule, RuleDraft, RuleType } from '../../../shared/types.js';
import { validateRuleDraft } from '../../../shared/validation.js';
import { MAX_RULE_TEST_TEXT_LENGTH, testRuleDraft } from '../../../engine/rule-tester.js';

interface Props {
  initial: BlockRule | null;
  disabled: boolean;
  onSave: (draft: RuleDraft) => Promise<void>;
  onCancel: () => void;
}

const RULE_TYPES: RuleType[] = ['keyword', 'creator', 'phrase', 'regex'];

function initialDraft(rule: BlockRule | null): RuleDraft {
  return rule
    ? {
        type: rule.type,
        value: rule.value,
        aliases: rule.aliases,
        caseSensitive: rule.caseSensitive,
        wholeWord: rule.wholeWord,
      }
    : { type: 'keyword', value: '', aliases: [], caseSensitive: false, wholeWord: false };
}

export function RuleForm({ initial, disabled, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<RuleDraft>(() => initialDraft(initial));
  const [aliasText, setAliasText] = useState(() => initial?.aliases.join(', ') ?? '');
  const [valueError, setValueError] = useState('');
  const [sampleText, setSampleText] = useState('');

  useEffect(() => {
    setDraft(initialDraft(initial));
    setAliasText(initial?.aliases.join(', ') ?? '');
    setValueError('');
    setSampleText('');
  }, [initial]);

  function set<K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'type') {
        next.wholeWord = value === 'creator';
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const candidate: RuleDraft = {
      ...draft,
      value: draft.value.trim(),
      aliases: aliasText.split(',').map((alias) => alias.trim()).filter(Boolean),
    };
    const result = validateRuleDraft(candidate);
    if (!result.ok) {
      setValueError(result.errors.join(' '));
      return;
    }
    setValueError('');
    await onSave(result.value);
  }

  const isRegex = draft.type === 'regex';
  const shortSubstring = draft.value.trim().length > 0 && draft.value.trim().length < 4 && !draft.wholeWord;
  const candidate: RuleDraft = useMemo(() => ({
    ...draft,
    value: draft.value.trim(),
    aliases: aliasText.split(',').map((alias) => alias.trim()).filter(Boolean),
  }), [aliasText, draft]);
  const testOutcome = useMemo(() => testRuleDraft(candidate, sampleText), [candidate, sampleText]);

  return (
    <form className="rule-form" onSubmit={(event) => void handleSubmit(event)}>
      <p className="form-title">{initial ? 'Edit rule' : 'Add rule'}</p>
      <div className="form-grid">
        <div className="form-field span2">
          <label htmlFor="rf-value">Value {isRegex && <span className="label-help">(regular expression)</span>}</label>
          <input
            id="rf-value"
            type="text"
            value={draft.value}
            onChange={(event) => { set('value', event.target.value); setValueError(''); }}
            className={valueError ? 'error' : ''}
            placeholder={isRegex ? 'For example: ep\\.?\\s*\\d+' : 'For example: Kim Kardashian'}
            autoFocus
            disabled={disabled}
          />
          {valueError && <span className="field-error">{valueError}</span>}
          {shortSubstring && !valueError && <span className="field-warning">A short substring may hide unrelated results. Consider whole word matching.</span>}
        </div>

        <div className="form-field span2">
          <label htmlFor="rf-type">Type</label>
          <select id="rf-type" value={draft.type} disabled={disabled} onChange={(event) => set('type', event.target.value as RuleType)}>
            {RULE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>

        <div className="form-field span2">
          <label htmlFor="rf-aliases">Aliases <span className="label-help">(comma separated, optional)</span></label>
          <input
            id="rf-aliases"
            type="text"
            value={aliasText}
            onChange={(event) => setAliasText(event.target.value)}
            placeholder="For example: @KimK, Kimberly Kardashian"
            disabled={disabled}
          />
        </div>

        <div className="form-field span2">
          <span className="field-label">Options</span>
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input type="checkbox" checked={draft.wholeWord} onChange={(event) => set('wholeWord', event.target.checked)} disabled={disabled || isRegex} />
              Whole word
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={draft.caseSensitive} onChange={(event) => set('caseSensitive', event.target.checked)} disabled={disabled} />
              Case sensitive
            </label>
          </div>
        </div>
      </div>

      <div className="rule-tester">
        <div className="tester-heading">
          <div>
            <span className="field-label">Test this rule</span>
            <p>Paste sample text to test the unsaved rule. Sample text is never stored.</p>
          </div>
          <span className={`tester-result result-${testOutcome.status}`} aria-live="polite">
            {testOutcome.status === 'empty' && 'Waiting for sample text'}
            {testOutcome.status === 'invalid' && 'Rule needs attention'}
            {testOutcome.status === 'no_match' && 'No match'}
            {testOutcome.status === 'match' && 'Match'}
          </span>
        </div>
        <label className="sr-only" htmlFor="rf-sample">Sample text</label>
        <textarea
          id="rf-sample"
          value={sampleText}
          maxLength={MAX_RULE_TEST_TEXT_LENGTH}
          disabled={disabled}
          onChange={(event) => setSampleText(event.target.value)}
          placeholder="Paste a title, comment, or other sample text"
          rows={3}
        />
        <div className="tester-detail">
          <span>{sampleText.length.toLocaleString()} / {MAX_RULE_TEST_TEXT_LENGTH.toLocaleString()}</span>
          {testOutcome.status === 'invalid' && <span className="field-error">{testOutcome.message}</span>}
          {testOutcome.status === 'match' && <span>Matched: <code>{testOutcome.matchedText || '(empty match)'}</code></span>}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={disabled}>{initial ? 'Save changes' : 'Add rule'}</button>
        <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
