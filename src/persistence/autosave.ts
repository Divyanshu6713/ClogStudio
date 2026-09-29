import { studio, useStudio } from '@/state/store';
import { localProjects } from './repositories';

const DEBOUNCE_MS = 800;

/** Save the open project now (manual save / before leaving). */
export async function saveNow(): Promise<void> {
  const { project, rev, txnBase } = useStudio.getState();
  // Never persist a half-finished drag; the commit will trigger another save.
  if (!project || txnBase) return;
  studio.markSaving();
  try {
    await localProjects.save(project);
    studio.markSaved(rev);
  } catch (e) {
    studio.markSaveError(e instanceof Error ? e.message : String(e));
  }
}

/** Debounced autosave on every committed document change. Returns an unsubscribe. */
export function startAutosave(): () => void {
  let timer: number | undefined;
  const unsub = useStudio.subscribe((s, prev) => {
    if (!s.project || s.rev === prev.rev || s.txnBase) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(saveNow, DEBOUNCE_MS);
  });
  const beforeUnload = (e: BeforeUnloadEvent) => {
    const st = useStudio.getState();
    if (st.project && st.save.status !== 'saved') {
      void saveNow();
      e.preventDefault();
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    window.clearTimeout(timer);
    unsub();
    window.removeEventListener('beforeunload', beforeUnload);
  };
}
