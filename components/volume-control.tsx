'use client';

import { useAudio } from '@/components/audio-provider';
import { Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

export function VolumeControl({ className }: { className?: string }) {
  const { volume, setVolume, isMuted, toggleMute } = useAudio();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        onClick={toggleMute}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={isMuted ? 0 : volume}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        className="w-20 h-1.5 rounded-full appearance-none cursor-pointer bg-card border border-border accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
        aria-label="Volume"
      />
    </div>
  );
}
