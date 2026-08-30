'use client';

import { YouTubeEmbed, SpotifyEmbed, parseYouTubeId, parseSpotifyEmbed } from '@/components/youtube-embed';
import { cn } from '@/lib/utils';

type QuestionMediaProps = {
  imageUrl: string | null | undefined;
  videoUrl: string | null | undefined;
  videoHidden?: boolean;
  videoVolume?: number | null;
  audioUrl?: string | null | undefined;
  audioVolume?: number | null | undefined;
  audioStartMs?: number | null;
  audioHidden?: boolean;
  videoStartMs?: number | null;
  autoplay?: boolean;
  muted?: boolean;
  hideAudioControls?: boolean;
  className?: string;
  imgClassName?: string;
};

export function QuestionMedia({ imageUrl, videoUrl, videoHidden, videoVolume, audioUrl, audioVolume, audioStartMs, audioHidden, videoStartMs, autoplay, muted, hideAudioControls, className, imgClassName }: QuestionMediaProps) {
  const hasVideo = videoUrl && parseYouTubeId(videoUrl);
  if (hasVideo) {
    if (videoHidden) {
      return (
        <div aria-hidden style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
          <YouTubeEmbed
            url={videoUrl!}
            autoplay={autoplay}
            startSeconds={videoStartMs ? Math.floor(videoStartMs / 1000) : undefined}
            muted={muted}
            targetVolume={autoplay && !muted ? (videoVolume != null ? Math.round(videoVolume * 100) : 50) : undefined}
          />
        </div>
      );
    }
    return (
      <YouTubeEmbed
        url={videoUrl!}
        className={className}
        autoplay={autoplay}
        startSeconds={videoStartMs ? Math.floor(videoStartMs / 1000) : undefined}
        muted={muted}
        targetVolume={autoplay && !muted ? (videoVolume != null ? Math.round(videoVolume * 100) : 50) : undefined}
      />
    );
  }
  const isSpotify = audioUrl && parseSpotifyEmbed(audioUrl);
  if (isSpotify) {
    if (audioHidden) {
      return (
        <div aria-hidden style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
          <SpotifyEmbed
            url={audioUrl!}
            startSeconds={audioStartMs ? Math.floor(audioStartMs / 1000) : undefined}
            autoplay={autoplay}
            overlayLabel="Clicca per iniziare il quiz"
          />
        </div>
      );
    }
    if (hideAudioControls) return null;
    return (
      <SpotifyEmbed
        url={audioUrl!}
        startSeconds={audioStartMs ? Math.floor(audioStartMs / 1000) : undefined}
        className={className}
        compact
        autoplay={autoplay}
        overlayLabel="Clicca per ascoltare"
      />
    );
  }
  if (audioUrl) {
    if (hideAudioControls) return null;
    return (
      <div className={cn('w-full', className)}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          controls
          src={audioUrl}
          className="w-full rounded-lg"
          onLoadedMetadata={(e) => {
            const el = e.target as HTMLAudioElement;
            if (audioVolume != null) el.volume = Math.min(1, Math.max(0, audioVolume));
            if (audioStartMs && audioStartMs > 0) el.currentTime = audioStartMs / 1000;
          }}
        />
      </div>
    );
  }
  if (imageUrl) {
    return (
      <div className={cn('rounded-lg overflow-hidden flex justify-center', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className={cn('rounded-lg', imgClassName)} />
      </div>
    );
  }
  return null;
}
