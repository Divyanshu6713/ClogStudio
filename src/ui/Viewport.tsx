import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { StudioEngine, CAMERA_PRESETS, type CameraPresetId } from '@/engine/StudioEngine';
import { loadRenderBitmap } from '@/assets/assetRuntime';
import { ensureModel, modelKey, runtime, useRuntime } from '@/runtime';
import { useStudio } from '@/state/store';
import { useProject } from '@/state/selectors';
import { attachEngineSync, attachViewportInteraction } from './viewportInteraction';

interface Props {
  productMode: boolean;
  onToggleProductMode: () => void;
}

export function Viewport({ productMode, onToggleProductMode }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const project = useProject();
  const key = modelKey(project.model);
  const status = useRuntime((s) => s.status);
  const model = useRuntime((s) => s.model);
  const [engine, setEngine] = useState<StudioEngine | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [preset, setPreset] = useState<CameraPresetId | null>('q-right');

  // one engine per mounted viewport
  useEffect(() => {
    let e: StudioEngine;
    try {
      e = new StudioEngine(host.current!);
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
      return;
    }
    e.loadBitmap = loadRenderBitmap;
    e.onChange = () => useRuntime.setState((st) => ({ renderTick: st.renderTick + 1 })); // panels that read render info
    const offControls = () => setPreset(null);
    e.controls.addEventListener('start', offControls);
    runtime.engine = e;
    setEngine(e);
    const detachSync = attachEngineSync(e);
    const detachInput = attachViewportInteraction(e, e.renderer.domElement);
    if (import.meta.env.DEV)
      (window as unknown as Record<string, unknown>).__clogStudio = {
        engine: e,
        store: useStudio,
        runtime: useRuntime,
        consistencyCheck: () => import('@/dev/consistencyCheck').then((m) => m.consistencyCheck(e)),
      };
    return () => {
      detachInput();
      detachSync();
      e.controls.removeEventListener('start', offControls);
      e.dispose();
      if (runtime.engine === e) runtime.engine = null;
      setEngine(null);
    };
  }, []);

  useEffect(() => {
    ensureModel(project.model).catch(() => {});
  }, [key]);

  useEffect(() => {
    if (engine && model && useRuntime.getState().modelKey === key) {
      engine.setModel(model);
      setPreset('q-right');
    }
  }, [engine, model, key]);

  const goto = (id: CameraPresetId) => {
    engine?.setPreset(id);
    setPreset(id);
  };

  // number keys 1–8 → camera presets (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const p = CAMERA_PRESETS.find((c) => c.key === e.key);
      if (p) goto(p.id);
      else if (e.key === 'f' || e.key === 'F') onToggleProductMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const side = project.model.side;
  const sideLabel = (id: CameraPresetId) =>
    side === 'right' ? (id === 'right' ? 'outer side' : id === 'left' ? 'inner side' : '') : side === 'left' ? (id === 'left' ? 'outer side' : id === 'right' ? 'inner side' : '') : '';

  return (
    <section className="viewport" aria-label="3D clog view">
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />

      {!productMode && (
        <div className="vp-overlay vp-tl">
          {project.model.accuracy !== 'product' && (
            <span className="vp-chip warn" title={project.model.note}>
              <AlertTriangle size={13} />
              {project.model.accuracy === 'reference' ? 'Reference geometry — not a real product model' : 'Concept visualization'}
            </span>
          )}
          <span className="vp-chip" title="Dimensions are shown in model units until the model carries real calibration data.">
            {project.model.calibration ? `Calibrated · ${project.model.sizeLabel ?? 'size unknown'}` : 'Uncalibrated · model units'}
          </span>
          {project.model.side !== 'unknown' && <span className="vp-chip">Previewing {project.model.side} shoe</span>}
          <span className="vp-chip small-screen-note">For the full Design Studio experience, use a larger screen.</span>
        </div>
      )}

      <div className="vp-overlay vp-tr">
        <div className="float-bar">
          <button className="icon-btn" onClick={() => { engine?.resetCamera(); setPreset('q-right'); }} title="Reset camera" aria-label="Reset camera">
            <RotateCcw size={15} />
          </button>
          <button className="icon-btn" onClick={onToggleProductMode} title={productMode ? 'Exit product view (F)' : 'Product view — hide editor UI (F)'} aria-label={productMode ? 'Exit product view' : 'Enter product view'} aria-pressed={productMode}>
            {productMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      <div className="vp-overlay vp-bottom">
        <div className="float-bar" role="toolbar" aria-label="Camera views">
          {CAMERA_PRESETS.map((c) => (
            <button
              key={c.id}
              className="cam-btn"
              aria-pressed={preset === c.id}
              onClick={() => goto(c.id)}
              title={`${c.label}${sideLabel(c.id) ? ` (${sideLabel(c.id)})` : ''} — key ${c.key}. Only the camera moves; the design is unchanged.`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {!productMode && <div className="vp-hint desk-only">Drag to orbit · Scroll to zoom · Right-drag to pan · Drag artwork to move it on the surface</div>}

      {(status.state === 'loading' || status.state === 'error' || engineError) && (
        <div className="vp-overlay vp-center">
          <div className="loader-card" role={status.state === 'error' || engineError ? 'alert' : 'status'}>
            {engineError ? (
              <>
                <strong>3D view unavailable</strong>
                <p className="muted">{engineError}</p>
              </>
            ) : status.state === 'error' ? (
              <>
                <strong>{status.label}</strong>
                <p className="muted">{status.error}</p>
                <button className="btn" onClick={() => ensureModel(project.model).catch(() => {})}>Try again</button>
              </>
            ) : (
              <>
                <strong>{status.label}</strong>
                {status.progress !== null && <span className="faint"> {Math.round(status.progress * 100)}%</span>}
                <div className={`progress ${status.progress === null ? 'indeterminate' : ''}`}>
                  <div style={status.progress === null ? undefined : { width: `${status.progress * 100}%` }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
