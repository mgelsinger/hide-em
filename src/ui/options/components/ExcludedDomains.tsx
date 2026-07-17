import React, { useState } from 'react';
import type { ExcludedDomain } from '../../../shared/types.js';

interface Props {
  domains: ExcludedDomain[];
  disabled: boolean;
  onAdd: (input: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

export function ExcludedDomains({ domains, disabled, onAdd, onDelete, onToggle }: Props) {
  const [input, setInput] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    if (await onAdd(input)) setInput('');
  }

  return (
    <div>
      <form className="domain-form" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="excluded-domain">Domain to exclude</label>
        <input
          id="excluded-domain"
          type="text"
          value={input}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          placeholder="twitch.tv or https://example.com"
        />
        <button type="submit" className="btn btn-primary" disabled={disabled || !input.trim()}>Add domain</button>
      </form>
      {domains.length === 0 ? (
        <div className="empty-state compact">No excluded sites.</div>
      ) : (
        <ul className="domain-list">
          {domains.map((domain) => (
            <li key={domain.id} className={`domain-item${domain.enabled ? '' : ' disabled'}`}>
              <label className="toggle" aria-label={`${domain.enabled ? 'Disable' : 'Enable'} exclusion for ${domain.hostname}`}>
                <input type="checkbox" checked={domain.enabled} disabled={disabled} onChange={(event) => onToggle(domain.id, event.target.checked)} />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
              <span className="domain-name">{domain.hostname}</span>
              <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => onDelete(domain.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
