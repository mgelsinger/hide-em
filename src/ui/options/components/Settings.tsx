import React from 'react';
import type { Settings } from '../../../shared/types.js';
import { PLATFORMS } from '../../../shared/types.js';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span className="toggle-thumb" />
    </label>
  );
}

export function Settings({ settings, onChange }: Props) {
  function setPlatform(p: string, enabled: boolean) {
    onChange({
      ...settings,
      perPlatformEnabled: { ...settings.perPlatformEnabled, [p]: enabled },
    });
  }

  return (
    <>
      <div className="setting-row">
        <span className="setting-label">Extension enabled</span>
        <Toggle checked={settings.enabled} onChange={(v) => onChange({ ...settings, enabled: v })} />
      </div>
      <div className="setting-row">
        <span className="setting-label">Debug logging</span>
        <Toggle checked={settings.debug} onChange={(v) => onChange({ ...settings, debug: v })} />
      </div>
      <div style={{ marginTop: 12, marginBottom: 6, fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Per-platform
      </div>
      {PLATFORMS.map((p) => (
        <div key={p} className="setting-row">
          <span className="setting-label">{p}</span>
          <Toggle
            checked={settings.perPlatformEnabled[p] ?? true}
            onChange={(v) => setPlatform(p, v)}
          />
        </div>
      ))}
    </>
  );
}
