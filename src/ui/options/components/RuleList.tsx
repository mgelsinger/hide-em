import React, { useState } from 'react';
import type { BlockRule, RuleScope } from '../../../shared/types.js';

interface Props {
  rules: BlockRule[];
  onEdit: (rule: BlockRule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

const SCOPE_ABBR: Record<keyof RuleScope, string> = {
  titles: 'T',
  channels: 'C',
  comments: 'CM',
  descriptions: 'D',
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span className="toggle-thumb" />
    </label>
  );
}

function RuleItem({
  rule,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: BlockRule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (v: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const activeScopes = (Object.keys(rule.scope) as (keyof RuleScope)[]).filter(
    (k) => rule.scope[k],
  );

  if (confirming) {
    return (
      <li className="rule-item">
        <span className="confirm-delete">Delete "{rule.value}"?</span>
        <button className="btn btn-danger btn-sm" onClick={onDelete}>Yes, delete</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
      </li>
    );
  }

  return (
    <li className={`rule-item${rule.enabled ? '' : ' disabled'}`}>
      <Toggle checked={rule.enabled} onChange={onToggle} />
      <span className={`rule-badge badge-${rule.type}`}>{rule.type}</span>
      <span className="rule-value">
        {rule.value}
        {rule.aliases.length > 0 && (
          <span className="rule-aliases">+ {rule.aliases.length} alias{rule.aliases.length !== 1 ? 'es' : ''}</span>
        )}
      </span>
      <span className="rule-scope-tags">
        {activeScopes.map((s) => (
          <span key={s} className="scope-tag" title={s}>{SCOPE_ABBR[s]}</span>
        ))}
      </span>
      <span className="rule-actions">
        <button className="btn btn-ghost btn-sm" title="Edit" onClick={onEdit}>✏️</button>
        <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => setConfirming(true)}>🗑</button>
      </span>
    </li>
  );
}

export function RuleList({ rules, onEdit, onDelete, onToggle }: Props) {
  if (rules.length === 0) {
    return <div className="empty-state">No rules yet. Add one above to get started.</div>;
  }

  return (
    <ul className="rule-list">
      {rules.map((rule) => (
        <RuleItem
          key={rule.id}
          rule={rule}
          onEdit={() => onEdit(rule)}
          onDelete={() => onDelete(rule.id)}
          onToggle={(v) => onToggle(rule.id, v)}
        />
      ))}
    </ul>
  );
}
