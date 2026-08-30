'use client';

import { useState, useRef, useEffect } from 'react';
import { Palette, Check } from 'lucide-react';
import { useTheme, THEMES, type ThemeId } from '@/components/theme-provider';
import { cn } from '@/lib/utils';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-200',
          'border-border bg-card/60 hover:bg-card hover:border-primary/40 text-muted-foreground hover:text-foreground',
          open && 'bg-card border-primary/40 text-foreground'
        )}
        title="Change theme"
      >
        <Palette className="w-4 h-4" />
        <span className="hidden sm:inline">{current.label}</span>
        <div className="flex gap-0.5">
          {current.swatch.map((c, i) => (
            <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
          ))}
        </div>
      </button>

      {/* Dropdown panel */}
      <div
        className={cn(
          'absolute right-0 top-full mt-2 w-64 z-50 origin-top-right',
          'rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-2xl overflow-hidden',
          'transition-all duration-200',
          open
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
        )}
      >
        <div className="p-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5">
            App theme
          </p>
          {THEMES.map((t) => (
            <ThemeOption
              key={t.id}
              theme={t}
              active={theme === t.id}
              onSelect={() => { setTheme(t.id as ThemeId); setOpen(false); }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeOption({
  theme,
  active,
  onSelect,
}: {
  theme: (typeof THEMES)[number];
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-left transition-all duration-150',
        active
          ? 'bg-primary/15 text-foreground'
          : 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'
      )}
    >
      {/* Swatch dots */}
      <div className="flex gap-1 shrink-0">
        {theme.swatch.map((c, i) => (
          <span
            key={i}
            className="w-4 h-4 rounded-full border border-white/10 shadow-inner"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-none mb-0.5">{theme.label}</p>
        <p className="text-[11px] text-muted-foreground leading-none">{theme.description}</p>
      </div>
      {active && <Check className="w-4 h-4 text-primary shrink-0" />}
    </button>
  );
}
