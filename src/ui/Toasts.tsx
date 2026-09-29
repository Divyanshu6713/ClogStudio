import { X } from 'lucide-react';
import { dismissToast, useRuntime } from '@/runtime';

export function Toasts() {
  const toasts = useRuntime((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss message">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
