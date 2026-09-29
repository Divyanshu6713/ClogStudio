import { useRef, useState } from 'react';
import { Download, ImagePlus, Plus } from 'lucide-react';
import type { AssetMeta } from '@/domain/types';
import { ARTWORK_ACCEPT } from '@/assets/importArtwork';
import { downloadOriginal } from '@/assets/assetRuntime';
import { defaultPlacement } from '@/engine/placement';
import { cmd } from '@/state/commands';
import { useProject } from '@/state/selectors';
import { useStudio } from '@/state/store';
import { toast, useRuntime } from '@/runtime';
import { uploadArtwork } from '../actions';
import { useAssetUrl } from '../useAssetUrl';

export function UploadPanel() {
  const project = useProject();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const modelReady = useRuntime((s) => !!s.model);
  const zoneId = useStudio((s) => s.selectedZoneId);
  const zones = project.model.zones.filter((z) => z.printable);
  const target = zones.find((z) => z.id === zoneId) ?? zones[0];
  const artwork = Object.values(project.assets).filter((a) => a.kind !== 'model');

  const take = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    await uploadArtwork(files);
    setBusy(false);
  };

  return (
    <>
      <div className="panel-head">Artwork</div>
      <div className="panel-scroll">
        <div className="section">
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void take([...e.dataTransfer.files]);
            }}
          >
            <ImagePlus size={22} strokeWidth={1.6} />
            <div><b>Drop artwork here</b></div>
            <div className="faint" style={{ fontSize: 11.5 }}>PNG (transparency kept), JPEG, WebP, SVG · up to 40 MB</div>
            <input ref={input} type="file" accept={ARTWORK_ACCEPT} multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void take(f); }} />
            <button className="btn accent" disabled={busy || !modelReady} onClick={() => input.current?.click()}>
              {busy ? 'Processing…' : 'Choose files…'}
            </button>
          </div>
          <p className="hint">
            New artwork goes on <b>{target?.label ?? '—'}</b>
            {zones.length > 1 && ' (pick another zone in Colours)'}. Your file is stored unchanged; it is only positioned, scaled and rotated.
          </p>
        </div>
        <div className="section">
          <div className="section-title">In this project <span className="faint">({artwork.length})</span></div>
          {artwork.length === 0 && <p className="hint" style={{ marginTop: 0 }}>No artwork yet.</p>}
          {artwork.map((a) => (
            <AssetRow key={a.id} asset={a} onPlace={() => {
              const m = useRuntime.getState().model;
              const p = m && target ? defaultPlacement(m, target.id, (a.preview?.width ?? a.width ?? 1) / (a.preview?.height ?? a.height ?? 1)) : null;
              if (!p) return toast('Could not find a printable surface for this artwork.', 'error');
              cmd.addAssetWithLayer(a, a.name.replace(/\.[a-z0-9]+$/i, ''), p);
            }} />
          ))}
        </div>
      </div>
    </>
  );
}

function AssetRow({ asset, onPlace }: { asset: AssetMeta; onPlace: () => void }) {
  const url = useAssetUrl(asset.id);
  return (
    <div className="asset-row">
      {url ? <img className="thumb" src={url} alt="" /> : <span className="thumb" />}
      <div style={{ minWidth: 0 }}>
        <div className="layer-name" title={asset.name}>{asset.name}</div>
        <div className="layer-sub">{asset.width}×{asset.height}px · {asset.kind === 'svg' ? 'SVG' : asset.mime.split('/')[1].toUpperCase()}</div>
      </div>
      <div style={{ display: 'flex' }}>
        <button className="icon-btn sm" title="Place another copy" aria-label={`Place another copy of ${asset.name}`} onClick={onPlace}><Plus size={14} /></button>
        <button className="icon-btn sm" title="Download original file (unchanged)" aria-label={`Download original ${asset.name}`} onClick={() => downloadOriginal(asset).catch((e) => toast(String(e.message ?? e), 'error'))}><Download size={14} /></button>
      </div>
    </div>
  );
}
