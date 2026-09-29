import { useEffect, useState } from 'react';
import { normalizeHex } from '@/domain/factory';
import type { Hex, ZoneDef } from '@/domain/types';
import { cmd } from '@/state/commands';
import { studio, useStudio } from '@/state/store';
import { useProject, useVersion } from '@/state/selectors';

const RECENT_KEY = 'clog-studio:recent-colors';

function loadRecent(): Hex[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]').filter((c: unknown) => typeof c === 'string' && normalizeHex(c)).slice(0, 12);
  } catch {
    return [];
  }
}

function pushRecent(c: Hex, list: Hex[]): Hex[] {
  const next = [c, ...list.filter((x) => x !== c)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* per-viewer convenience only */
  }
  return next;
}

const rgb = (hex: Hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `R ${(n >> 16) & 255} · G ${(n >> 8) & 255} · B ${n & 255}`;
};

export function ColorsPanel() {
  const project = useProject();
  const version = useVersion();
  const selectedZone = useStudio((s) => s.selectedZoneId);
  const [recent, setRecent] = useState<Hex[]>(loadRecent);

  const setColor = (zone: string, c: Hex, remember = true) => {
    cmd.setZoneColor(zone, c);
    if (remember) setRecent((r) => pushRecent(c, r));
  };

  return (
    <>
      <div className="panel-head">Colour zones</div>
      <div className="panel-scroll">
        <div className="section">
          {project.model.zones.map((z) => (
            <ZoneRow
              key={z.id}
              zone={z}
              color={version.materials[z.id]?.color ?? '#BFBFBF'}
              active={selectedZone === z.id}
              onSelect={() => studio.selectZone(z.id)}
              onColor={(c, remember) => setColor(z.id, c, remember)}
            />
          ))}
          <p className="hint">Click a zone to make it the target for new artwork and for recent colours.</p>
        </div>
        {recent.length > 0 && (
          <div className="section">
            <div className="section-title">Recent colours</div>
            <div className="recent">
              {recent.map((c) => (
                <button
                  key={c}
                  style={{ background: c }}
                  title={`${c} → ${selectedZone ? project.model.zones.find((z) => z.id === selectedZone)?.label : 'select a zone first'}`}
                  aria-label={`Apply ${c} to selected zone`}
                  disabled={!selectedZone}
                  onClick={() => selectedZone && setColor(selectedZone, c)}
                />
              ))}
            </div>
          </div>
        )}
        <div className="section">
          <div className="section-title">Saved palettes <span className="soon-tag">Later</span></div>
          <p className="hint" style={{ marginTop: 0 }}>One-click palettes (e.g. Body / Strap / Sole sets) arrive with versions, so colour variants can be compared side by side.</p>
        </div>
        <div className="section">
          <div className="note">Digital colours vary between monitors, lighting environments and manufactured materials. The viewer uses neutral studio lighting and PBR Neutral tone mapping to keep HEX values close to how they are shown here.</div>
        </div>
      </div>
    </>
  );
}

function ZoneRow({ zone, color, active, onSelect, onColor }: { zone: ZoneDef; color: Hex; active: boolean; onSelect: () => void; onColor: (c: Hex, remember: boolean) => void }) {
  const [hex, setHex] = useState(color);
  useEffect(() => setHex(color), [color]);
  const valid = normalizeHex(hex) !== null;
  const commitHex = () => {
    const n = normalizeHex(hex);
    if (n && n !== color) onColor(n, true);
    else setHex(color);
  };
  return (
    <div>
      <div className={`zone-row ${active ? 'active' : ''}`} onClick={onSelect}>
        <span className="swatch" style={{ background: color }}>
          <input
            type="color"
            value={color.toLowerCase()}
            aria-label={`${zone.label} colour picker`}
            onChange={(e) => onColor(e.target.value.toUpperCase(), false)}
            onBlur={(e) => onColor(e.target.value.toUpperCase(), true)}
          />
        </span>
        <span>
          <div className="zone-name">{zone.label}</div>
          <div className="zone-sub">{zone.printable ? 'Printable' : 'Colour only'}</div>
        </span>
        <input
          className="hex-input"
          aria-label={`${zone.label} HEX`}
          aria-invalid={!valid}
          value={hex}
          maxLength={7}
          onChange={(e) => setHex(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => e.key === 'Enter' && commitHex()}
        />
      </div>
      {active && <div className="rgb-line">{rgb(color)}</div>}
    </div>
  );
}
