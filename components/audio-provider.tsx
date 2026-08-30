'use client';

import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';

type Track = 'menu' | 'game' | 'none';

type AudioState = {
  volume: number;
  setVolume: (v: number) => void;
  track: Track;
  playTrack: (t: Track) => void;
  playTrackIfDifferent: (t: Track) => void;
  toggleMute: () => void;
  isMuted: boolean;
};

const AudioContextCtx = createContext<AudioState | null>(null);

export function useAudio() {
  const ctx = useContext(AudioContextCtx);
  if (!ctx) throw new Error('useAudio must be used within AudioProvider');
  return ctx;
}

// Procedural music using Web Audio API — no external files needed.
// Menu: calm, slow ambient pad. Game: faster, more energetic arpeggio.

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [volume, setVolumeState] = useState(0.3);
  const [track, setTrack] = useState<Track>('none');
  const trackRef = useRef<Track>('none');
  const [isMuted, setIsMuted] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const oscillatorsRef = useRef<OscillatorNode[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeRef = useRef(0.3);
  const mutedRef = useRef(true);

  // Load saved volume from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('quiz-volume');
    if (saved !== null) {
      const v = parseFloat(saved);
      if (!isNaN(v) && v >= 0 && v <= 1) {
        setVolumeState(v);
        volumeRef.current = v;
      }
    }
  }, []);

  const ensureContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
      masterGainRef.current = audioCtxRef.current.createGain();
      masterGainRef.current.gain.value = mutedRef.current ? 0 : volumeRef.current;
      masterGainRef.current.connect(audioCtxRef.current.destination);
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const stopAll = useCallback(() => {
    oscillatorsRef.current.forEach((osc) => {
      try { osc.stop(); } catch {}
      try { osc.disconnect(); } catch {}
    });
    oscillatorsRef.current = [];
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const playMenu = useCallback((ctx: AudioContext, gain: GainNode) => {
    // Calm ambient pad — slow chord progression
    const notes = [220, 277.18, 329.63, 220, 261.63, 329.63]; // A minor-ish progression
    let step = 0;

    const playChord = () => {
      const base = notes[step % notes.length];
      step++;
      const oscs: OscillatorNode[] = [];
      [1, 1.5, 2].forEach((mult, i) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.value = base * mult;
        oscGain.gain.setValueAtTime(0, ctx.currentTime);
        oscGain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 1.5);
        oscGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 3.5);
        osc.connect(oscGain);
        oscGain.connect(gain);
        osc.start();
        osc.stop(ctx.currentTime + 4);
        oscs.push(osc);
      });
      oscillatorsRef.current.push(...oscs);
      // Clean up old oscillators
      setTimeout(() => {
        oscs.forEach((o) => {
          oscillatorsRef.current = oscillatorsRef.current.filter((x) => x !== o);
        });
      }, 4500);
    };

    playChord();
    intervalRef.current = setInterval(playChord, 4000);
  }, []);

  const playGame = useCallback((ctx: AudioContext, gain: GainNode) => {
    // Energetic arpeggio — faster tempo, brighter tones
    const scale = [261.63, 329.63, 392, 523.25, 392, 329.63]; // C major arpeggio
    let step = 0;

    const playNote = () => {
      const freq = scale[step % scale.length];
      step++;
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      oscGain.gain.setValueAtTime(0, ctx.currentTime);
      oscGain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.02);
      oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(oscGain);
      oscGain.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      oscillatorsRef.current.push(osc);
      setTimeout(() => {
        oscillatorsRef.current = oscillatorsRef.current.filter((x) => x !== osc);
      }, 400);
    };

    playNote();
    intervalRef.current = setInterval(playNote, 300);
  }, []);

  const playTrack = useCallback((t: Track) => {
    setTrack(t);
    trackRef.current = t;
    const ctx = ensureContext();
    if (!ctx || !masterGainRef.current) return;
    stopAll();
    if (t === 'menu') playMenu(ctx, masterGainRef.current);
    else if (t === 'game') playGame(ctx, masterGainRef.current);
  }, [ensureContext, stopAll, playMenu, playGame]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    volumeRef.current = clamped;
    if (masterGainRef.current && !mutedRef.current) {
      masterGainRef.current.gain.value = clamped;
    }
    localStorage.setItem('quiz-volume', String(clamped));
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      if (masterGainRef.current) {
        masterGainRef.current.gain.value = next ? 0 : volumeRef.current;
      }
      return next;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, [stopAll]);

  const playTrackIfDifferent = useCallback((t: Track) => {
    if (trackRef.current === t) return;
    playTrack(t);
  }, [playTrack]);

  return (
    <AudioContextCtx.Provider value={{ volume, setVolume, track, playTrack, playTrackIfDifferent, toggleMute, isMuted }}>
      {children}
    </AudioContextCtx.Provider>
  );
}
