import { useEffect, useState } from 'react';
import { useStudio } from '@/state/store';

function ago(t: number | null, now: number) {
  if (!t) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function SaveStatus() {
  const save = useStudio((s) => s.save);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const text =
    save.status === 'saving' ? 'Saving…' : save.status === 'dirty' ? 'Unsaved changes' : save.status === 'error' ? 'Save failed' : `Saved ${ago(save.lastSavedAt, now)}`;
  return (
    <span className="save-status" role="status" aria-label={text} title={save.error ?? 'Projects autosave to this browser.'}>
      <span className={`save-dot ${save.status}`} aria-hidden />
      <span className="save-text">{text}</span>
    </span>
  );
}
