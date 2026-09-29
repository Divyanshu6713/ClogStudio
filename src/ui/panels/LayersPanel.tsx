import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import type { Layer } from '@/domain/types';
import { cmd } from '@/state/commands';
import { studio, useStudio } from '@/state/store';
import { useVersion } from '@/state/selectors';
import { useAssetUrl } from '../useAssetUrl';
import { duplicate, remove } from '../actions';

export function LayersPanel() {
  const version = useVersion();
  const selected = useStudio((s) => s.selectedLayerId);
  const [drag, setDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null);
  // Displayed top → bottom; stored bottom → top.
  const rows = [...version.layers].reverse();
  const sel = version.layers.find((l) => l.id === selected);
  const selIndex = sel ? version.layers.indexOf(sel) : -1;

  const drop = () => {
    if (!drag?.over || drag.over === drag.id) return setDrag(null);
    const from = version.layers.findIndex((l) => l.id === drag.id);
    let to = version.layers.findIndex((l) => l.id === drag.over);
    // visual "after" (below) = lower index in storage order
    if (drag.after) to = to - (from < to ? 1 : 0);
    else to = to + (from > to ? 1 : 0);
    cmd.moveLayer(drag.id, to);
    setDrag(null);
  };

  return (
    <section className="layers" aria-label="Layers">
      <div className="panel-head">Layers <span className="spacer" style={{ flex: 1 }} /><span className="faint" style={{ letterSpacing: 0 }}>{version.layers.length}</span></div>
      <ul className="layer-list" role="listbox" aria-label="Design layers, top first">
        {rows.map((l) => (
          <LayerRow
            key={l.id}
            layer={l}
            selected={l.id === selected}
            dropClass={drag?.over === l.id && drag.id !== l.id ? (drag.after ? 'drop-after' : 'drop-before') : ''}
            onDragStart={() => setDrag({ id: l.id, over: null, after: false })}
            onDragOver={(after) => setDrag((d) => (d ? { ...d, over: l.id, after } : d))}
            onDrop={drop}
            onDragEnd={() => setDrag(null)}
          />
        ))}
        <li className="layer base" title="Product geometry is locked in design mode">
          <span />
          <span className="thumb" style={{ background: '#ecebe7' }} />
          <span>
            <div className="layer-name">Base clog</div>
            <div className="layer-sub">Geometry locked</div>
          </span>
          <Lock size={13} aria-label="Locked" />
        </li>
      </ul>
      <div className="layer-actions">
        <button className="icon-btn sm" disabled={!sel || selIndex >= version.layers.length - 1} onClick={() => sel && cmd.moveLayer(sel.id, selIndex + 1)} title="Bring forward" aria-label="Bring forward"><ArrowUp size={14} /></button>
        <button className="icon-btn sm" disabled={!sel || selIndex <= 0} onClick={() => sel && cmd.moveLayer(sel.id, selIndex - 1)} title="Send backward" aria-label="Send backward"><ArrowDown size={14} /></button>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="icon-btn sm" disabled={!sel} onClick={() => sel && duplicate(sel.id)} title="Duplicate (Ctrl+D)" aria-label="Duplicate layer"><Copy size={14} /></button>
        <button className="icon-btn sm" disabled={!sel || sel.locked} onClick={() => sel && remove(sel.id)} title="Delete (Del)" aria-label="Delete layer"><Trash2 size={14} /></button>
      </div>
    </section>
  );
}

interface RowProps {
  layer: Layer;
  selected: boolean;
  dropClass: string;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function LayerRow({ layer, selected, dropClass, onDragStart, onDragOver, onDrop, onDragEnd }: RowProps) {
  const url = useAssetUrl(layer.assetId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.name);

  const commitName = () => {
    setEditing(false);
    const n = name.trim();
    if (n && n !== layer.name) cmd.updateLayer(layer.id, `Rename ${layer.name}`, { name: n });
    else setName(layer.name);
  };

  return (
    <li
      className={`layer ${selected ? 'selected' : ''} ${layer.visible ? '' : 'hidden-layer'} ${dropClass}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      draggable={!editing}
      onClick={() => studio.select(layer.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') setEditing(true);
        if (e.key === ' ') {
          e.preventDefault();
          studio.select(layer.id);
        }
      }}
      onDoubleClick={() => {
        setName(layer.name);
        setEditing(true);
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(e.clientY > r.top + r.height / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <button
        className="icon-btn sm"
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        title={layer.visible ? 'Hide (kept in the design)' : 'Show'}
        onClick={(e) => {
          e.stopPropagation();
          cmd.updateLayer(layer.id, `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, { visible: !layer.visible });
        }}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      {url ? <img className="thumb" src={url} alt="" draggable={false} /> : <span className="thumb" />}
      <span style={{ minWidth: 0 }}>
        {editing ? (
          <input
            className="layer-name-input"
            autoFocus
            value={name}
            aria-label="Layer name"
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setName(layer.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <>
            <div className="layer-name" title={`${layer.name} — double-click to rename`}>{layer.name}</div>
            <div className="layer-sub">{layer.placement.surfaceLabel}{layer.opacity < 1 ? ` · ${Math.round(layer.opacity * 100)}%` : ''}</div>
          </>
        )}
      </span>
      <button
        className="icon-btn sm"
        aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        title={layer.locked ? 'Unlock' : 'Lock'}
        aria-pressed={layer.locked}
        onClick={(e) => {
          e.stopPropagation();
          cmd.updateLayer(layer.id, `${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`, { locked: !layer.locked });
        }}
      >
        {layer.locked ? <Lock size={13} /> : <LockOpen size={13} style={{ opacity: 0.45 }} />}
      </button>
    </li>
  );
}
