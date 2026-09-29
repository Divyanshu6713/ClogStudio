import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  /** accessible name, e.g. "Width" */
  name: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  unit?: string;
  disabled?: boolean;
  title?: string;
}

/**
 * Compact numeric input. Type a value and press Enter (or leave the field);
 * drag horizontally on the letter label to scrub; ↑/↓ step (Shift ×10).
 */
export function NumberField({ label, name, value, onChange, step = 0.01, min = -Infinity, max = Infinity, precision = 3, unit, disabled, title }: Props) {
  const [text, setText] = useState(fmt(value, precision));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value, precision));
  }, [value, precision]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    if (Number.isFinite(v) && Math.abs(clamp(v) - value) > 1e-12) onChange(clamp(v));
    else setText(fmt(value, precision));
  };

  const scrub = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (disabled) return;
    const startX = e.clientX;
    const start = value;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const px = ev.clientX - startX;
      onChange(clamp(round(start + px * step * (ev.shiftKey ? 10 : 1), precision)));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div className="num" title={title}>
      <label onPointerDown={scrub} aria-hidden>{label}</label>
      <input
        aria-label={name}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setText(fmt(value, precision));
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp(round(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), precision));
            onChange(v);
            setText(fmt(v, precision));
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

const round = (v: number, p: number) => Math.round(v * 10 ** p) / 10 ** p;
const fmt = (v: number, p: number) => String(round(v, p));
