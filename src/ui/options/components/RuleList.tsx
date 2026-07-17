import React, { useState } from 'react';
import type { BlockRule } from '../../../shared/types.js';

interface Props {
  rules: BlockRule[];
  disabled: boolean;
  onEdit: (rule: BlockRule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle" aria-label={label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track" />
      <span className="toggle-thumb" />
    </label>
  );
}

function RuleItem({ rule, disabled, onEdit, onDelete, onToggle }: {
  rule: BlockRule;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (value: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <li className="rule-item confirmation-row">
        <span className="confirm-delete">Delete &quot;{rule.value}&quot;?</span>
        <button className="btn btn-danger btn-sm" disabled={disabled} onClick={onDelete}>Delete</button>
        <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => setConfirming(false)}>Cancel</button>
      </li>
    );
  }

  return (
    <li className={`rule-item${rule.enabled ? '' : ' disabled'}`}>
      <Toggle checked={rule.enabled} disabled={disabled} label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.value}`} onChange={onToggle} />
      <span className={`rule-badge badge-${rule.type}`}>{rule.type}</span>
      <span className="rule-value" title={rule.value}>
        {rule.value}
        {rule.aliases.length > 0 && <span className="rule-aliases">+ {rule.aliases.length} alias{rule.aliases.length === 1 ? '' : 'es'}</span>}
      </span>
      <span className="rule-actions">
        <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={onEdit}>Edit</button>
        <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => setConfirming(true)}>Delete</button>
      </span>
    </li>
  );
}

export function RuleList({ rules, disabled, onEdit, onDelete, onToggle }: Props) {
  if (rules.length === 0) return <div className="empty-state">No rules yet. Add one above to get started.</div>;
  return (
    <ul className="rule-list">
      {rules.map((rule) => (
        <RuleItem
          key={rule.id}
          rule={rule}
          disabled={disabled}
          onEdit={() => onEdit(rule)}
          onDelete={() => onDelete(rule.id)}
          onToggle={(enabled) => onToggle(rule.id, enabled)}
        />
      ))}
    </ul>
  );
}
