// Studio store: the open project document + undo/redo history + UI selection.
//
// History is snapshot-based. The project document is immutable (immer), so each
// snapshot shares structure with its neighbours and costs very little memory.
// Continuous interactions (dragging artwork, scrubbing a slider) run inside a
// *transaction*: the document updates live, but only one history entry is
// recorded when the interaction ends.

import { create } from 'zustand';
import { produce, freeze } from 'immer';
import type { ID, Project } from '@/domain/types';

export interface HistoryEntry {
  label: string;
  /** document state BEFORE the labelled change */
  project: Project;
  key?: string;
  at: number;
}

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

interface StudioState {
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  txnBase: Project | null;
  selectedLayerId: ID | null;
  /** zone highlighted in the Materials panel */
  selectedZoneId: string | null;
  /** increments on every document change; used by autosave */
  rev: number;
  save: { status: SaveStatus; savedRev: number; lastSavedAt: number | null; error: string | null };
}

const HISTORY_LIMIT = 200;
const COALESCE_MS = 700;

export const useStudio = create<StudioState>(() => ({
  project: null,
  past: [],
  future: [],
  txnBase: null,
  selectedLayerId: null,
  selectedZoneId: null,
  rev: 0,
  save: { status: 'saved', savedRev: 0, lastSavedAt: null, error: null },
}));

const set = useStudio.setState;
const get = useStudio.getState;

type Recipe = (draft: Project) => void;

function stamp(p: Project): Project {
  return produce(p, (d) => {
    d.updatedAt = Date.now();
    const v = d.versions.find((x) => x.id === d.activeVersionId);
    if (v) v.updatedAt = d.updatedAt;
  });
}

export const studio = {
  /** Open a project document (no history). */
  open(project: Project) {
    set({
      project: freeze(project, true),
      past: [],
      future: [],
      txnBase: null,
      selectedLayerId: null,
      selectedZoneId: null,
      rev: 0,
      save: { status: 'saved', savedRev: 0, lastSavedAt: project.updatedAt, error: null },
    });
  },

  close() {
    set({ project: null, past: [], future: [], txnBase: null, selectedLayerId: null, rev: 0 });
  },

  /**
   * Apply one undoable change. Consecutive changes with the same `coalesce`
   * key inside a short window merge into one history entry (arrow nudges,
   * typing into a numeric field).
   */
  apply(label: string, recipe: Recipe, coalesce?: string) {
    const { project, past, txnBase } = get();
    if (!project) return;
    if (txnBase) {
      // A change arriving mid-transaction is folded into the transaction.
      set({ project: produce(project, recipe), rev: get().rev + 1 });
      return;
    }
    const produced = produce(project, recipe);
    if (produced === project) return;
    const next = stamp(produced);
    const last = past[past.length - 1];
    const now = Date.now();
    const merge = coalesce && last?.key === coalesce && now - last.at < COALESCE_MS;
    const entry: HistoryEntry = { label, project, key: coalesce, at: now };
    const nextPast = merge ? [...past.slice(0, -1), { ...last, at: now }] : [...past, entry].slice(-HISTORY_LIMIT);
    set({ project: next, past: nextPast, future: [], rev: get().rev + 1 });
  },

  /** Start a continuous interaction. */
  begin() {
    const { project, txnBase } = get();
    if (project && !txnBase) set({ txnBase: project });
  },

  /** Live update inside a transaction (no history entry). */
  preview(recipe: Recipe) {
    const { project, txnBase } = get();
    if (!project) return;
    if (!txnBase) set({ txnBase: project });
    set({ project: produce(project, recipe), rev: get().rev + 1 });
  },

  /** Finish a continuous interaction: records ONE history entry. */
  commit(label: string) {
    const { project, txnBase, past } = get();
    if (!project || !txnBase) return;
    if (project === txnBase) {
      set({ txnBase: null });
      return;
    }
    set({
      project: stamp(project),
      txnBase: null,
      past: [...past, { label, project: txnBase, at: Date.now() }].slice(-HISTORY_LIMIT),
      future: [],
      rev: get().rev + 1,
    });
  },

  /** Abort a continuous interaction and restore the state it started from. */
  cancel() {
    const { txnBase } = get();
    if (txnBase) set({ project: txnBase, txnBase: null, rev: get().rev + 1 });
  },

  undo() {
    const { past, future, project, txnBase } = get();
    if (!project || txnBase || past.length === 0) return;
    const entry = past[past.length - 1];
    set({
      project: entry.project,
      past: past.slice(0, -1),
      future: [{ label: entry.label, project, at: Date.now() }, ...future],
      rev: get().rev + 1,
    });
    studio.pruneSelection();
  },

  redo() {
    const { past, future, project, txnBase } = get();
    if (!project || txnBase || future.length === 0) return;
    const entry = future[0];
    set({
      project: entry.project,
      past: [...past, { label: entry.label, project, at: Date.now() }],
      future: future.slice(1),
      rev: get().rev + 1,
    });
    studio.pruneSelection();
  },

  select(layerId: ID | null) {
    set({ selectedLayerId: layerId });
  },

  selectZone(zoneId: string | null) {
    set({ selectedZoneId: zoneId });
  },

  /** Drop the selection if the selected layer no longer exists (after undo/delete). */
  pruneSelection() {
    const { project, selectedLayerId } = get();
    if (!project || !selectedLayerId) return;
    const v = project.versions.find((x) => x.id === project.activeVersionId);
    if (!v?.layers.some((l) => l.id === selectedLayerId)) set({ selectedLayerId: null });
  },

  markSaving() {
    set({ save: { ...get().save, status: 'saving', error: null } });
  },
  markSaved(rev: number) {
    const s = get();
    set({ save: { status: s.rev === rev ? 'saved' : 'dirty', savedRev: rev, lastSavedAt: Date.now(), error: null } });
  },
  markSaveError(message: string) {
    set({ save: { ...get().save, status: 'error', error: message } });
  },
};

// Any document change marks the project dirty.
useStudio.subscribe((s, prev) => {
  if (s.rev !== prev.rev && s.project && s.save.status !== 'saving' && s.rev !== s.save.savedRev) {
    if (s.save.status !== 'dirty') set({ save: { ...s.save, status: 'dirty' } });
  }
});
