import { useEffect, useState } from 'react';
import { Box, Brush, Gem, ImagePlus, Palette, Shapes, Sticker, Type } from 'lucide-react';
import { startAutosave, saveNow } from '@/persistence/autosave';
import { studio, useStudio } from '@/state/store';
import { TopBar } from './TopBar';
import { BottomBar } from './BottomBar';
import { Viewport, isTyping } from './Viewport';
import { ColorsPanel } from './panels/ColorsPanel';
import { UploadPanel } from './panels/UploadPanel';
import { ModelPanel } from './panels/ModelPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { LayersPanel } from './panels/LayersPanel';
import { duplicate, nudge, remove, rotateBy } from './actions';

type Tool = 'colors' | 'upload' | 'model';

const TOOLS: Array<{ id: Tool | 'text' | 'patterns' | 'stickers' | 'charms' | 'draw'; label: string; icon: typeof Palette; ready: boolean }> = [
  { id: 'colors', label: 'Colours', icon: Palette, ready: true },
  { id: 'upload', label: 'Artwork', icon: ImagePlus, ready: true },
  { id: 'text', label: 'Text', icon: Type, ready: false },
  { id: 'patterns', label: 'Patterns', icon: Shapes, ready: false },
  { id: 'stickers', label: 'Stickers', icon: Sticker, ready: false },
  { id: 'charms', label: 'Charms', icon: Gem, ready: false },
  { id: 'draw', label: 'Draw', icon: Brush, ready: false },
];

export function Studio() {
  const [tool, setTool] = useState<Tool>('colors');
  const [productMode, setProductMode] = useState(false);

  useEffect(() => startAutosave(), []);

  // Global editor shortcuts. Text fields keep their native behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) studio.redo();
        else studio.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        studio.redo();
        return;
      }
      const sel = useStudio.getState().selectedLayerId;
      if (e.key === 'Escape') {
        if (productMode) setProductMode(false);
        else studio.select(null);
        return;
      }
      if (!sel) return;
      if (mod && k === 'd') {
        e.preventDefault();
        duplicate(sel);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(sel);
      } else if (e.key.startsWith('Arrow') && !mod) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowRight' ? n : e.key === 'ArrowLeft' ? -n : 0;
        const dy = e.key === 'ArrowUp' ? n : e.key === 'ArrowDown' ? -n : 0;
        nudge(sel, dx, dy);
      } else if (e.key === '[' || e.key === ']') {
        rotateBy(sel, (e.key === '[' ? -1 : 1) * (e.shiftKey ? 15 : 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [productMode]);

  return (
    <div className={`studio ${productMode ? 'product-mode' : ''}`}>
      <TopBar />
      <nav className="rail" aria-label="Design tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className="rail-btn"
            disabled={!t.ready}
            aria-pressed={tool === t.id}
            title={t.ready ? t.label : `${t.label} — not implemented yet (planned after the core surface-mapping milestone)`}
            onClick={() => t.ready && setTool(t.id as Tool)}
          >
            {!t.ready && <span className="soon">LATER</span>}
            <t.icon size={18} strokeWidth={1.8} />
            {t.label}
          </button>
        ))}
        <span className="grow" />
        <button className="rail-btn" aria-pressed={tool === 'model'} onClick={() => setTool('model')} title="Clog model information">
          <Box size={18} strokeWidth={1.8} />
          Model
        </button>
      </nav>
      <aside className="leftpanel" aria-label="Tool panel">
        {tool === 'colors' && <ColorsPanel />}
        {tool === 'upload' && <UploadPanel />}
        {tool === 'model' && <ModelPanel />}
      </aside>
      <Viewport productMode={productMode} onToggleProductMode={() => setProductMode((v) => !v)} />
      <aside className="rightpanel" aria-label="Properties and layers">
        <PropertiesPanel />
        <LayersPanel />
      </aside>
      <BottomBar />
    </div>
  );
}
