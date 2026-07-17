import React from 'react';
import type { Settings as SettingsType } from '../../../shared/types.js';

interface Props {
  settings: SettingsType;
  disabled: boolean;
  onChange: (patch: Partial<SettingsType>) => void;
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

export function Settings({ settings, disabled, onChange }: Props) {
  return (
    <>
      <div className="setting-row">
        <span>
          <strong className="setting-label">Extension enabled</strong>
          <small>Pause or resume hiding on every site.</small>
        </span>
        <Toggle checked={settings.enabled} disabled={disabled} label="Extension enabled" onChange={(enabled) => onChange({ enabled })} />
      </div>
      <div className="setting-row">
        <span>
          <strong className="setting-label">Debug logging</strong>
          <small>Show scanner details in the page console.</small>
        </span>
        <Toggle checked={settings.debug} disabled={disabled} label="Debug logging" onChange={(debug) => onChange({ debug })} />
      </div>
    </>
  );
}
