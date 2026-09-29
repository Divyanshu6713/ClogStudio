import { useState } from 'react';
import { Columns2, Download, GitBranch, Redo2, Save, Undo2 } from 'lucide-react';
import { saveNow } from '@/persistence/autosave';
import { studio, useStudio } from '@/state/store';
import { Disclaimer } from './Disclaimer';

export function BottomBar() {
  const undoLabel = useStudio((s) => s.past[s.past.length - 1]?.label ?? null);
  const redoLabel = useStudio((s) => s.future[0]?.label ?? null);
  const saveStatus = useStudio((s) => s.save.status);
  const [disc, setDisc] = useState(false);

  return (
    <footer className="bottombar">
      <button className="btn ghost" onClick={studio.undo} disabled={!undoLabel} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}>
        <Undo2 size={15} /> Undo
      </button>
      <button className="btn ghost" onClick={studio.redo} disabled={!redoLabel} title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}>
        <Redo2 size={15} /> Redo
      </button>
      <span className="vsep desk-only" />
      <button className="btn ghost desk-only" disabled title="Before/after and version comparison — not implemented yet (build step 14)">
        <Columns2 size={15} /> Compare <span className="soon-tag">Later</span>
      </button>
      <button className="btn ghost desk-only" disabled title="Duplicate / branch / switch versions — not implemented yet (build step 13)">
        <GitBranch size={15} /> Versions <span className="soon-tag">Later</span>
      </button>
      <span className="spacer" />
      <button className="disclaimer-link" onClick={() => setDisc(true)}>Digital visualization — final product may vary</button>
      <span className="vsep desk-only" />
      <button className="btn ghost desk-only" onClick={() => void saveNow()} disabled={saveStatus === 'saving'} title="Save now (Ctrl+S). Changes also autosave.">
        <Save size={15} /> Save
      </button>
      <button className="btn desk-only" disabled title="Multi-view PNG + design specification export — not implemented yet (build step 15)">
        <Download size={15} /> Export <span className="soon-tag">Later</span>
      </button>
      {disc && <Disclaimer onClose={() => setDisc(false)} />}
    </footer>
  );
}
