'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Camera, Check, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  NICKNAME_MAX, NICKNAME_MIN, checkAvatarFile, getMyProfile, nicknameAvailable, setProfile, uploadAvatar,
} from '@/lib/profile';
import { ZOOM_MAX, clampFraming, cropToFile, type Framing } from '@/lib/avatar-crop';
import { HeaderBack, HeaderEnd } from '@/components/header-controls';
import { Button } from '@/components/ui/button';
import { RangeInput } from '@/components/ui/range-input';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RecoverySettings } from '@/components/recovery-settings';
import { useToast } from '@/hooks/use-toast';

const ERRORS: Record<string, string> = {
  nickname_taken: 'This username is already taken.',
  invalid_nickname: `Use ${NICKNAME_MIN} to ${NICKNAME_MAX} characters.`,
  invalid_avatar: 'This picture cannot be used.',
};

function ProfileForm() {
  const router = useRouter();
  const { toast } = useToast();
  const params = useSearchParams();
  const welcome = params.get('welcome') === '1';
  const codeUsed = params.get('code') === 'used';
  const fileRef = useRef<HTMLInputElement>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nickname, setNickname] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Framing of a newly chosen picture: drag to move it, slider or mouse wheel to zoom.
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [framing, setFraming] = useState<Framing>({ zoom: 1, x: 0, y: 0 });
  const reframe = (next: (f: Framing) => Framing) => setFraming((f) => clampFraming(natural.w, natural.h, next(f)));

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setFraming((f) => clampFraming(natural.w, natural.h, { ...f, zoom: f.zoom - e.deltaY * 0.002 }));
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [preview, natural]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace('/');
        return;
      }
      setUserId(user.id);
      const profile = await getMyProfile(user.id);
      const meta = user.user_metadata as { nickname?: string } | undefined;
      setNickname(profile?.nickname ?? meta?.nickname ?? '');
      setAvatarUrl(profile?.avatar_url ?? null);
      setLoading(false);
    });
  }, [router]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen) return;
    const invalid = checkAvatarFile(chosen);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setRemoveAvatar(false);
    setFraming({ zoom: 1, x: 0, y: 0 });
    setNatural({ w: 1, h: 1 });
    setFile(chosen);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const nick = nickname.trim();
    if (nick.length < NICKNAME_MIN || nick.length > NICKNAME_MAX) {
      setError(ERRORS.invalid_nickname);
      return;
    }
    if (!userId) return;
    setSaving(true);
    setError(null);
    if (!(await nicknameAvailable(nick))) {
      setSaving(false);
      setError(ERRORS.nickname_taken);
      return;
    }
    let nextAvatar: string | null | undefined; // undefined keeps the current picture
    if (file && preview) {
      let framed: File;
      try {
        framed = await cropToFile(preview, framing, file.type);
      } catch {
        setSaving(false);
        setError(ERRORS.invalid_avatar);
        return;
      }
      const up = await uploadAvatar(userId, framed);
      if (up.error) {
        setSaving(false);
        setError(up.error);
        return;
      }
      nextAvatar = up.url;
    } else if (removeAvatar) {
      nextAvatar = '';
    }
    const { profile, error: failure } = await setProfile(nick, nextAvatar);
    setSaving(false);
    if (!profile) {
      setError(ERRORS[failure ?? ''] ?? 'Could not save. Try again.');
      return;
    }
    // Keep the sign-in token in step so older screens that read it show the new name.
    await supabase.auth.updateUser({ data: { nickname: profile.nickname } });
    toast({ title: 'Profile saved' });
    router.push('/dashboard');
  };

  const shown = removeAvatar ? null : preview ?? avatarUrl;
  const initial = (nickname.trim() || '?').charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-grid relative">
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
      <div className="relative z-10 max-w-md mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          {!welcome ? <HeaderBack href="/dashboard" label="Back to my quizzes" /> : <span />}
          <HeaderEnd />
        </div>

        <Card className="border-border bg-card/80 backdrop-blur-md">
          <CardHeader>
            <CardTitle>{welcome ? 'Choose your username' : 'Your profile'}</CardTitle>
            <CardDescription>
              {welcome ? 'Pick the name other people will see, and add a picture if you like.' : 'Change your username or picture.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <form onSubmit={save} className="space-y-6">
                <div className="flex items-center gap-4">
                  {preview && !removeAvatar ? (
                    <div
                      ref={frameRef}
                      className="w-32 h-32 rounded-full overflow-hidden relative shrink-0 cursor-grab active:cursor-grabbing touch-none select-none ring-2 ring-primary"
                      title="Drag to move, scroll to zoom"
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drag.current = { x: e.clientX, y: e.clientY };
                      }}
                      onPointerMove={(e) => {
                        const start = drag.current;
                        const size = frameRef.current?.clientWidth;
                        if (!start || !size) return;
                        drag.current = { x: e.clientX, y: e.clientY };
                        reframe((f) => ({ ...f, x: f.x + (e.clientX - start.x) / size, y: f.y + (e.clientY - start.y) / size }));
                      }}
                      onPointerUp={() => (drag.current = null)}
                      onPointerCancel={() => (drag.current = null)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview}
                        alt="Profile picture"
                        draggable={false}
                        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                        className="absolute max-w-none pointer-events-none"
                        style={{
                          width: `${(natural.w / Math.min(natural.w, natural.h)) * framing.zoom * 100}%`,
                          height: `${(natural.h / Math.min(natural.w, natural.h)) * framing.zoom * 100}%`,
                          left: `${50 + framing.x * 100}%`,
                          top: `${50 + framing.y * 100}%`,
                          transform: 'translate(-50%, -50%)',
                        }}
                      />
                    </div>
                  ) : (
                  <div className="w-20 h-20 rounded-full overflow-hidden bg-primary text-primary-foreground flex items-center justify-center text-3xl font-semibold shrink-0">
                    {shown ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={shown} alt="Profile picture" className="w-full h-full object-cover" />
                    ) : (
                      initial
                    )}
                  </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={pick} aria-label="Choose a picture" />
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => fileRef.current?.click()}>
                      <Camera className="w-4 h-4" /> Choose picture
                    </Button>
                    {(shown || avatarUrl) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-muted-foreground"
                        onClick={() => {
                          setFile(null);
                          setRemoveAvatar(true);
                        }}
                      >
                        <Trash2 className="w-4 h-4" /> Remove
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">JPG or PNG, 1 MB at most.</p>
                  </div>
                </div>

                {preview && !removeAvatar && (
                  <div className="space-y-1">
                    <label htmlFor="avatar-zoom" className="text-sm font-medium">Zoom</label>
                    <RangeInput
                      id="avatar-zoom"
                      min={1}
                      max={ZOOM_MAX}
                      step={0.01}
                      value={framing.zoom}
                      onChange={(e) => {
                        const zoom = Number(e.target.value);
                        reframe((f) => ({ ...f, zoom }));
                      }}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">Drag the picture to move it inside the circle.</p>
                  </div>
                )}

                <div className="space-y-2">
                  <label htmlFor="username" className="text-sm font-medium">Username</label>
                  <Input
                    id="username"
                    value={nickname}
                    maxLength={NICKNAME_MAX}
                    onChange={(e) => {
                      setNickname(e.target.value);
                      setError(null);
                    }}
                    autoComplete="off"
                    autoFocus={welcome}
                  />
                  <p className="text-xs text-muted-foreground">{NICKNAME_MIN} to {NICKNAME_MAX} characters, unique.</p>
                </div>

                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

                <Button type="submit" className="w-full gap-2" disabled={saving}>
                  <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {!welcome && <RecoverySettings fresh={codeUsed} />}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfileForm />
    </Suspense>
  );
}
