'use client';

import { useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Upload } from 'lucide-react';
import { getGuestSession } from '@/lib/supabase';
import { QUESTION_IMAGE_ACCEPT, QUESTION_IMAGE_MAX_MB, uploadQuestionImage } from '@/lib/image-upload';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/help-tip';
import { Input } from '@/components/ui/input';

/*
  Pictures in the editor: paste a URL or upload a file from the device (signed-in
  accounts only, resized before upload). Used by every question type.
*/

export const UPLOAD_HELP = `Paste a URL, or upload a JPG, PNG, WebP, GIF, AVIF or BMP up to ${QUESTION_IMAGE_MAX_MB} MB.`;
export const GUEST_UPLOAD_HELP = 'Guests can paste an image URL. Sign in to upload pictures from your device.';

/** The Upload button; hidden for guests, who cannot store files. */
export function UploadButton({ onUploaded, onError }: { onUploaded: (url: string) => void; onError: (message: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (getGuestSession()) return null;

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    onError(null);
    const res = await uploadQuestionImage(file);
    setBusy(false);
    if (res.url) onUploaded(res.url);
    else onError(res.error ?? 'Upload failed.');
  };

  return (
    <>
      <input ref={fileRef} type="file" accept={QUESTION_IMAGE_ACCEPT} className="hidden" onChange={pick} aria-label="Upload a picture" />
      <Button type="button" variant="outline" className="gap-2 shrink-0" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
      </Button>
    </>
  );
}

/** A picture: URL field, Upload button, help text and a small preview. */
export function ImageUrlField({
  label, value, onChange, placeholder = 'https://… image URL', preview = false, optional = false, help,
}: { label: string; value: string; onChange: (url: string) => void; placeholder?: string; preview?: boolean; optional?: boolean; help?: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <ImageIcon className="w-3.5 h-3.5" /> {label}
        {optional && <span className="text-muted-foreground/60">(optional)</span>}
        <HelpTip>
          {help && <p>{help}</p>}
          <p>{getGuestSession() ? GUEST_UPLOAD_HELP : UPLOAD_HELP}</p>
        </HelpTip>
      </label>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1" aria-label={label} />
        <UploadButton onUploaded={onChange} onError={setError} />
      </div>
      {error && <p role="alert" className="text-xs text-destructive mt-1">{error}</p>}
      {preview && value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-2 h-24 rounded-lg object-cover border border-border" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} onLoad={(e) => { (e.target as HTMLImageElement).style.display = ''; }} />
      )}
    </div>
  );
}
