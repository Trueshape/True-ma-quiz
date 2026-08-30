'use client';

import { useRef, useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export function parseYouTubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const embedMatch = trimmed.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  return null;
}

// Returns the Spotify track/episode/playlist URI segment (e.g. "track/4iJyoBOLtHqaWYs3vyWmck")
export function parseSpotifyEmbed(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  // Handles optional locale prefix: open.spotify.com/intl-it/track/ID, open.spotify.com/track/ID, etc.
  const match = trimmed.match(/open\.spotify\.com\/(?:[a-z]{2,5}-[a-z]{2,5}\/|intl-[a-z]+\/)?(track|episode|playlist|album)\/([A-Za-z0-9]+)/);
  if (match) return `${match[1]}/${match[2]}`;
  // spotify:track:ID
  const uriMatch = trimmed.match(/^spotify:(track|episode|playlist|album):([A-Za-z0-9]+)$/);
  if (uriMatch) return `${uriMatch[1]}/${uriMatch[2]}`;
  return null;
}

type YouTubeEmbedProps = {
  url: string;
  className?: string;
  autoplay?: boolean;
  startSeconds?: number;
  muted?: boolean;
  targetVolume?: number;
  videoVolume?: number;
};

export function YouTubeEmbed({ url, className, autoplay, startSeconds, muted, targetVolume, videoVolume }: YouTubeEmbedProps) {
  const videoId = parseYouTubeId(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const resolvedVolume = targetVolume ?? (autoplay ? 50 : 100);

  useEffect(() => {
    if (!autoplay || muted) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const setVolume = () => {
      try {
        iframe.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [resolvedVolume] }),
          '*'
        );
      } catch {}
    };

    const t1 = setTimeout(setVolume, 500);
    const t2 = setTimeout(setVolume, 1500);
    iframe.addEventListener('load', setVolume);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      iframe.removeEventListener('load', setVolume);
    };
  }, [autoplay, muted, resolvedVolume]);

  if (!videoId) return null;
  const baseParams = new URLSearchParams();
  if (startSeconds && startSeconds > 0) baseParams.set('start', String(Math.floor(startSeconds)));
  baseParams.set('rel', '0');
  const extra = baseParams.toString();
  const autoplayFlag = autoplay ? '1' : '0';
  const src = `https://www.youtube.com/embed/${videoId}?autoplay=${autoplayFlag}&mute=0&enablejsapi=1${extra ? `&${extra}` : ''}`;
  return (
    <div className={cn('relative w-full overflow-hidden rounded-lg', className)} style={{ paddingBottom: '56.25%', height: 0 }}>
      <iframe
        key={src}
        ref={iframeRef}
        src={src}
        title="YouTube video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: '0' }}
      />
    </div>
  );
}

type SpotifyEmbedProps = {
  url: string;
  startSeconds?: number;
  className?: string;
  compact?: boolean;
  autoplay?: boolean;
  overlayLabel?: string;
};

export function SpotifyEmbed({ url, startSeconds, className, compact, autoplay, overlayLabel }: SpotifyEmbedProps) {
  const path = parseSpotifyEmbed(url);
  const [started, setStarted] = useState(!autoplay);
  if (!path) return null;
  const params = new URLSearchParams();
  params.set('utm_source', 'generator');
  if (startSeconds && startSeconds > 0) params.set('t', String(Math.floor(startSeconds)));
  if (autoplay) params.set('autoplay', '1');
  const src = `https://open.spotify.com/embed/${path}?${params.toString()}`;
  const height = compact ? 80 : 152;
  return (
    <div className={cn('w-full rounded-xl overflow-hidden relative', className)}>
      <iframe
        src={started ? src : undefined}
        width="100%"
        height={height}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        style={{ border: 0, borderRadius: 12 }}
        title="Spotify player"
      />
      {autoplay && !started && (
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card/90 backdrop-blur-sm hover:bg-card/80 transition-colors cursor-pointer"
        >
          <span className="flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg">
            <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
          </span>
          <span className="text-sm font-medium text-foreground">{overlayLabel ?? 'Clicca per avviare l\'audio'}</span>
        </button>
      )}
    </div>
  );
}
