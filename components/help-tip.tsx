'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A small "?" next to a title. Its explanation shows on hover and keyboard focus, and
 * on tap (phones); a tap elsewhere or Escape closes it.
 */
export function HelpTip({ children, label = 'More information', className }: { children: React.ReactNode; label?: string; className?: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const open = pinned || hover;

  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [pinned]);

  return (
    <span ref={ref} className={cn('relative inline-flex align-middle', className)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="w-4 h-4 rounded-full border border-muted-foreground/60 text-[10px] font-bold leading-none text-muted-foreground hover:text-foreground hover:border-foreground flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-64 max-w-[80vw] rounded-lg border border-border bg-popover text-popover-foreground shadow-xl p-3 text-xs font-normal leading-relaxed normal-case tracking-normal whitespace-normal text-left space-y-1.5"
        >
          {children}
        </span>
      )}
    </span>
  );
}
