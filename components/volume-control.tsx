'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useAudio } from '@/components/audio-provider';
import { cn } from '@/lib/utils';

export function VolumeControl() {
  const { volume, setVolume, isMuted, toggleMute } = useAudio();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const level = isMuted ? 0 : volume;
  const Icon = level === 0 ? VolumeX : Volume2;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center justify-center h-10 w-10 rounded-lg border transition-all duration-200',
          'border-border bg-card/60 hover:bg-card hover:border-primary/40 text-muted-foreground hover:text-foreground',
          open && 'bg-card border-primary/40 text-foreground'
        )}
        title="Volume"
        aria-label="Volume"
        aria-expanded={open}
      >
        <Icon className="w-4 h-4" />
      </button>

      <div
        className={cn(
          'absolute right-0 top-full mt-2 w-56 z-50 origin-top-right p-3',
          'rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-2xl',
          'transition-all duration-200',
          open
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
        )}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={toggleMute}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            <Icon className="w-4 h-4" />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={level}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-card border border-border accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
            aria-label="Volume level"
          />
          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{Math.round(level * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
