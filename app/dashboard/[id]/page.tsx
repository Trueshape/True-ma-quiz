'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, GripVertical, Image as ImageIcon, Save, Check, X, Info, Sliders, Type, List, ArrowUp, ArrowDown, ArrowRight as ArrowRightIcon, Play, Copy, ZoomOut, Grid3x3, TextCursorInput } from 'lucide-react';
import { YouTubeEmbed, parseYouTubeId } from '@/components/youtube-embed';
import { supabase, type Quiz, type Question, type QuestionType, decayStartMs, getGuestSession } from '@/lib/supabase';
import { saveQuiz } from '@/lib/game-api';
import { TagBox } from '@/components/tag-box';
import { MAX_TAGS, countTags, normalizeTag, type TagCount } from '@/lib/tags';
import { HeaderBack, HeaderEnd } from '@/components/header-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { MAX_BLANKS, defaultRevealConfig, isNewType, isRevealType, parseBlanks, type RevealConfig } from '@/lib/reveal';
import { AcceptedAnswers, RevealSettings } from '@/components/reveal-editor';
import { ImageUrlField, UploadButton } from '@/components/image-field';

type QuestionDraft = {
  id?: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  correct_index: number;
  image_url: string;
  video_url: string;
  video_start_ms: number;
  video_hidden: boolean;
  video_volume: number;
  audio_url: string;
  audio_volume: number;
  audio_start_ms: number;
  audio_hidden: boolean;
  time_limit_ms: number;
  position: number;
  slider_min: number;
  slider_max: number;
  slider_answer: number;
  reorder_correct_order: number[];
  reorder_item_images: string[];
  open_answers: string[];
  points_value: number;
  info_image_position: 'top' | 'bottom' | 'left' | 'right';
  reveal_config: RevealConfig;
  points_decay_start_ms: number | null;
  shuffle_options: boolean;
  solution_image_url: string;
};

const TF_OPTIONS = ['True', 'False'];

// Convert mm:ss string to milliseconds. Returns 0 on invalid input.
function parseTimeInput(value: string): number {
  const trimmed = value.trim();
  const parts = trimmed.split(':');
  if (parts.length === 1) {
    const secs = parseInt(parts[0]);
    return isNaN(secs) ? 0 : Math.max(0, secs) * 1000;
  }
  const mins = parseInt(parts[0]) || 0;
  const secs = parseInt(parts[1]) || 0;
  return Math.max(0, mins * 60 + secs) * 1000;
}

// Convert milliseconds to mm:ss string.
function formatTimeMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function QuizEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const quizId = params.id as string;

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState('');
  const [knownTags, setKnownTags] = useState<TagCount[]>([]);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const guest = getGuestSession();
    if (guest) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.push('/');
      } else {
      }
      setAuthLoading(false);
    });
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: q }, { data: qs }] = await Promise.all([
      supabase.from('quizzes').select('*').eq('id', quizId).maybeSingle(),
      supabase.from('questions').select('*').eq('quiz_id', quizId).order('position', { ascending: true }),
    ]);
    if (!q) {
      toast({ title: 'Quiz not found', variant: 'destructive' });
      router.push('/dashboard');
      return;
    }
    setQuiz(q as Quiz);
    setTitle(q.title);
    setDescription(q.description || '');
    setCoverImage(q.cover_image_url || '');
    setTags(q.tags ?? []);
    setQuestions(
      ((qs || []) as Question[]).map((x) => ({
        id: x.id,
        type: x.type,
        prompt: x.prompt,
        options: x.options,
        correct_index: x.correct_index,
        image_url: x.image_url || '',
        video_url: x.video_url || '',
        video_start_ms: x.video_start_ms ?? 0,
        video_hidden: x.video_hidden ?? false,
        video_volume: x.video_volume ?? 1.0,
        audio_url: x.audio_url || '',
        audio_volume: x.audio_volume ?? 0.5,
        audio_start_ms: x.audio_start_ms ?? 0,
        audio_hidden: x.audio_hidden ?? false,
        time_limit_ms: x.time_limit_ms,
        position: x.position,
        slider_min: x.slider_min ?? 0,
        slider_max: x.slider_max ?? 100,
        slider_answer: x.slider_answer ?? 50,
        reorder_correct_order: x.reorder_correct_order ?? [],
        reorder_item_images: x.reorder_item_images ?? [],
        open_answers: x.open_answers ?? [],
        points_value: x.points_value ?? 1000,
        info_image_position: (x.info_image_position as 'top' | 'bottom' | 'left' | 'right') ?? 'top',
        reveal_config: x.reveal_config ?? {},
        points_decay_start_ms: x.points_decay_start_ms ?? null,
        shuffle_options: x.shuffle_options ?? false,
        solution_image_url: x.solution_image_url ?? '',
      }))
    );
    setLoading(false);
  }, [quizId, router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    supabase
      .from('quizzes')
      .select('tags')
      .then(({ data }) => setKnownTags(countTags((data ?? []).map((r) => r.tags as string[] | null))));
  }, []);

  const addQuestion = (type: QuestionType) => {
    const newQ: QuestionDraft = {
      type,
      prompt: '',
      options: type === 'tf' ? [...TF_OPTIONS] : type === 'mc' ? ['', '', '', ''] : type === 'reorder' ? ['', '', ''] : [],
      correct_index: 0,
      image_url: '',
      video_url: '',
      video_start_ms: 0,
      video_hidden: false,
      video_volume: 1.0,
      audio_url: '',
      audio_volume: 0.5,
      audio_start_ms: 0,
      audio_hidden: false,
      time_limit_ms: type === 'info' ? 0 : 30000,
      position: questions.length,
      slider_min: 0,
      slider_max: 100,
      slider_answer: 50,
      reorder_correct_order: type === 'reorder' ? [0, 1, 2] : [],
      reorder_item_images: type === 'reorder' ? ['', '', ''] : [],
      open_answers: type === 'open' || isRevealType(type) ? [''] : [],
      points_value: 1000,
      info_image_position: 'top',
      reveal_config: defaultRevealConfig(type),
      points_decay_start_ms: null,
      shuffle_options: false,
      solution_image_url: '',
    };
    setQuestions((q) => [...q, newQ]);
  };

  const updateQuestion = (idx: number, patch: Partial<QuestionDraft>) => {
    setQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };

  // The copy goes right after the original, without its id so it is saved as a new question.
  const duplicateQuestion = (idx: number) => {
    setQuestions((qs) => {
      const { id: _id, ...copy } = qs[idx];
      const next = [...qs.slice(0, idx + 1), { ...copy }, ...qs.slice(idx + 1)];
      return next.map((q, i) => ({ ...q, position: i }));
    });
  };

  const removeQuestion = (idx: number) => {
    setQuestions((qs) => qs.filter((_, i) => i !== idx).map((q, i) => ({ ...q, position: i })));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    setQuestions((qs) => {
      const next = [...qs];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return qs;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((q, i) => ({ ...q, position: i }));
    });
  };

  const saveAll = async (): Promise<boolean> => {
    setSaving(true);
    for (const q of questions) {
      if (!q.prompt.trim()) {
        toast({ title: 'All questions need a prompt', variant: 'destructive' });
        setSaving(false);
        return false;
      }
      if (q.type === 'mc' && q.options.some((o) => !o.trim())) {
        toast({ title: 'Fill in all answer options', variant: 'destructive' });
        setSaving(false);
        return false;
      }
      if (q.type === 'reorder') {
        if (q.options.length < 3 || q.options.length > 10) {
          toast({ title: 'Reorder questions need 3–10 items', variant: 'destructive' });
          setSaving(false);
          return false;
        }
        const ALLOWED_EXT = /\.(jpg|jpeg|webp|png|gif|avif|bmp|svg|heic|heif)(\?|$)/i;
        for (let i = 0; i < q.options.length; i++) {
          const hasText = q.options[i].trim().length > 0;
          const imgUrl = q.reorder_item_images[i]?.trim() ?? '';
          const hasValidImg = imgUrl.length > 0 && ALLOWED_EXT.test(imgUrl);
          if (!hasText && !hasValidImg) {
            toast({ title: `Reorder item ${i + 1} needs text or a valid image URL (jpg, png, webp, gif, avif, bmp, svg, heic)`, variant: 'destructive' });
            setSaving(false);
            return false;
          }
          if (imgUrl.length > 0 && !ALLOWED_EXT.test(imgUrl)) {
            toast({ title: `Image URL for item ${i + 1} must end in jpg, png, webp, gif, avif, bmp, svg or heic`, variant: 'destructive' });
            setSaving(false);
            return false;
          }
        }
      }
      if (q.type === 'open') {
        if (q.open_answers.filter((a) => a.trim()).length === 0) {
          toast({ title: 'Add at least one accepted answer', variant: 'destructive' });
          setSaving(false);
          return false;
        }
      }
      if (isRevealType(q.type)) {
        if (!q.image_url.trim()) {
          toast({ title: 'De-zoom and Blocky questions need a picture', variant: 'destructive' });
          setSaving(false);
          return false;
        }
        if (q.open_answers.filter((a) => a.trim()).length === 0) {
          toast({ title: 'Add at least one accepted answer', variant: 'destructive' });
          setSaving(false);
          return false;
        }
      }
      if (q.type === 'blanks') {
        const gaps = parseBlanks(q.prompt).answers;
        if (gaps.length === 0 || gaps.length > MAX_BLANKS || gaps.some((g) => g.length === 0)) {
          toast({ title: `Fill the blanks needs 1 to ${MAX_BLANKS} blanks written as {{answer}}`, variant: 'destructive' });
          setSaving(false);
          return false;
        }
      }
      if (q.type === 'slider') {
        if (q.slider_min >= q.slider_max) {
          toast({ title: 'Slider min must be less than max', variant: 'destructive' });
          setSaving(false);
          return false;
        }
        if (q.slider_answer < q.slider_min || q.slider_answer > q.slider_max) {
          toast({ title: 'Slider answer must be within range', variant: 'destructive' });
          setSaving(false);
          return false;
        }
      }
    }

    const rows = questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt.trim(),
      options: q.type === 'tf' ? TF_OPTIONS : (q.type === 'mc' || q.type === 'reorder') ? q.options.map((o) => o.trim()) : [],
      correct_index: q.type === 'tf' ? (q.correct_index === 1 ? 1 : 0) : q.type === 'mc' ? q.correct_index : 0,
      image_url: q.image_url.trim() || null,
      video_url: q.video_url.trim() || null,
      video_start_ms: q.video_start_ms || 0,
      video_hidden: q.video_hidden,
      video_volume: q.video_volume,
      audio_url: q.audio_url.trim() || null,
      audio_volume: q.audio_volume,
      audio_start_ms: q.audio_start_ms || 0,
      audio_hidden: q.audio_hidden,
      time_limit_ms: q.time_limit_ms,
      slider_min: q.type === 'slider' ? q.slider_min : null,
      slider_max: q.type === 'slider' ? q.slider_max : null,
      slider_answer: q.type === 'slider' ? q.slider_answer : null,
      reorder_correct_order: q.type === 'reorder' ? q.reorder_correct_order : null,
      reorder_item_images: q.type === 'reorder' ? q.reorder_item_images.map((u) => u.trim() || '') : null,
      open_answers: q.type === 'open' || isRevealType(q.type) ? q.open_answers.map((a) => a.trim()).filter(Boolean) : null,
      points_value: q.points_value,
      info_image_position: q.info_image_position,
      reveal_config: isNewType(q.type) ? q.reveal_config : null,
      points_decay_start_ms: q.type === 'info' ? null : q.points_decay_start_ms,
      shuffle_options: q.type === 'mc' && q.shuffle_options,
      solution_image_url: q.type === 'info' ? null : q.solution_image_url.trim() || null,
    }));
    const pendingTag = normalizeTag(tagText);
    const finalTags = pendingTag && !tags.includes(pendingTag) && tags.length < MAX_TAGS ? [...tags, pendingTag] : tags;
    const { error: saveErr } = await saveQuiz(
      quizId,
      { title: title.trim(), description: description.trim(), cover_image_url: coverImage.trim(), tags: finalTags },
      rows
    );
    if (saveErr) {
      toast({ title: 'Failed to save quiz', description: saveErr.message, variant: 'destructive' });
      setSaving(false);
      return false;
    }
    setTagText('');
    toast({ title: 'Quiz saved', description: `${questions.length} question${questions.length !== 1 ? 's' : ''}` });
    setSaving(false);
    await load();
    return true;
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading quiz...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <div className="fixed inset-0 bg-grid pointer-events-none" />
      <div className="fixed top-0 right-0 w-96 h-96 bg-primary/15 rounded-full blur-3xl pointer-events-none" />

      {/* Sticky header */}
      <div className="sticky top-0 z-30 pointer-events-none">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between [&>*]:pointer-events-auto">
          <div className="flex items-center gap-3">
            <HeaderBack href="/dashboard" label="Back to my quizzes" />
            <div>
              <h1 className="text-xl font-bold">Edit quiz</h1>
              <p className="text-xs text-muted-foreground">{questions.length} questions</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {quizId && (
              <Button asChild variant="ghost" size="icon" title="Practice" aria-label="Practice">
                <Link href={`/practice/${quizId}`} target="_blank">
                  <Play className="w-4 h-4" />
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={saveAll} disabled={saving} title="Save" aria-label="Save">
              <Save className={saving ? 'w-4 h-4 animate-pulse' : 'w-4 h-4'} />
            </Button>
            <HeaderEnd />
          </div>
        </div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-8">
        <div className="flex gap-6 items-start">
          {/* Sticky left sidebar — question type buttons */}
          <div className="hidden md:flex flex-col gap-2 w-48 shrink-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">Add question</p>
            {([
              { type: 'info' as QuestionType, icon: <Info className="w-4 h-4" />, label: 'Info page' },
              { type: 'mc' as QuestionType, icon: <Plus className="w-4 h-4" />, label: 'Multiple choice' },
              { type: 'tf' as QuestionType, icon: <Check className="w-4 h-4" />, label: 'True / False' },
              { type: 'open' as QuestionType, icon: <Type className="w-4 h-4" />, label: 'Open answer' },
              { type: 'slider' as QuestionType, icon: <Sliders className="w-4 h-4" />, label: 'Slider' },
              { type: 'reorder' as QuestionType, icon: <List className="w-4 h-4" />, label: 'Reorder' },
              { type: 'dezoom' as QuestionType, icon: <ZoomOut className="w-4 h-4" />, label: 'De-zoom' },
              { type: 'blocky' as QuestionType, icon: <Grid3x3 className="w-4 h-4" />, label: 'Blocky' },
              { type: 'blanks' as QuestionType, icon: <TextCursorInput className="w-4 h-4" />, label: 'Fill the blanks' },
            ] as { type: QuestionType; icon: React.ReactNode; label: string }[]).map(({ type, icon, label }) => (
              <button
                key={type}
                onClick={() => addQuestion(type)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border bg-card/60 hover:bg-card hover:border-primary/40 hover:text-primary transition-all text-sm font-medium text-muted-foreground w-full text-left"
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          {/* Main content area */}
          <div className="flex-1 min-w-0">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">Quiz details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Title</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz title" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Description</label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" rows={2} />
                </div>
                <div>
                  <label htmlFor="quiz-tags" className="text-sm font-medium mb-1.5 block">Tags</label>
                  <TagBox
                    id="quiz-tags"
                    chips={tags}
                    onChipsChange={setTags}
                    text={tagText}
                    onTextChange={setTagText}
                    known={knownTags}
                    allowNew
                    suggestWhenEmpty
                    maxChips={MAX_TAGS}
                    placeholder="Add a tag, e.g. history"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">Press Enter or comma to add one. Up to {MAX_TAGS} tags; people find public quizzes by them.</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Cover image URL (optional)</label>
                  <Input value={coverImage} onChange={(e) => setCoverImage(e.target.value)} placeholder="https://..." />
                  {coverImage && (
                    <div className="mt-2 rounded-lg overflow-hidden border border-border h-32 bg-card">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={coverImage} alt="cover" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {questions.map((q, idx) => (
                <QuestionCard
                  key={idx}
                  question={q}
                  index={idx}
                  total={questions.length}
                  onChange={(patch) => updateQuestion(idx, patch)}
                  onRemove={() => removeQuestion(idx)}
                  onDuplicate={() => duplicateQuestion(idx)}
                  onMove={(dir) => moveQuestion(idx, dir)}
                />
              ))}
            </div>

            {/* Mobile fallback — question type buttons below questions */}
            <div className="md:hidden mt-6 grid grid-cols-2 gap-3">
              {([
                { type: 'info' as QuestionType, icon: <Info className="w-4 h-4" />, label: 'Info page' },
                { type: 'mc' as QuestionType, icon: <Plus className="w-5 h-5" />, label: 'Multiple choice' },
                { type: 'tf' as QuestionType, icon: <Check className="w-4 h-4" />, label: 'True / False' },
                { type: 'open' as QuestionType, icon: <Type className="w-5 h-5" />, label: 'Open answer' },
                { type: 'slider' as QuestionType, icon: <Sliders className="w-5 h-5" />, label: 'Slider' },
                { type: 'reorder' as QuestionType, icon: <List className="w-5 h-5" />, label: 'Reorder' },
                { type: 'dezoom' as QuestionType, icon: <ZoomOut className="w-5 h-5" />, label: 'De-zoom' },
                { type: 'blocky' as QuestionType, icon: <Grid3x3 className="w-5 h-5" />, label: 'Blocky' },
                { type: 'blanks' as QuestionType, icon: <TextCursorInput className="w-5 h-5" />, label: 'Fill the blanks' },
              ] as { type: QuestionType; icon: React.ReactNode; label: string }[]).map(({ type, icon, label }) => (
                <Button key={type} variant="outline" onClick={() => addQuestion(type)} className="gap-2 h-14 text-base">
                  {icon} {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const OPTION_COLORS = [
  'border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20',
  'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20',
  'border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20',
  'border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20',
  'border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20',
  'border-pink-500/40 bg-pink-500/10 hover:bg-pink-500/20',
];

function QuestionCard({
  question, index, total, onChange, onRemove, onDuplicate, onMove,
}: {
  question: QuestionDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<QuestionDraft>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [startTimeInput, setStartTimeInput] = useState(formatTimeMs(question.video_start_ms));
  const [audioStartTimeInput, setAudioStartTimeInput] = useState(formatTimeMs(question.audio_start_ms ?? 0));

  const isTF = question.type === 'tf';
  const isMC = question.type === 'mc';
  const isInfo = question.type === 'info';
  const isSlider = question.type === 'slider';
  const isReorder = question.type === 'reorder';
  const isOpen = question.type === 'open';
  const isNew = isNewType(question.type);
  const options = isTF ? TF_OPTIONS : question.options;

  const typeLabel = isTF ? 'True / False' : isMC ? 'Multiple choice' : isSlider ? 'Slider' : isReorder ? 'Reorder' : isOpen ? 'Open answer'
    : question.type === 'dezoom' ? 'De-zoom' : question.type === 'blocky' ? 'Blocky' : question.type === 'blanks' ? 'Fill the blanks' : 'Info page';
  const typeColor = isTF ? 'bg-accent/15 text-accent' : isMC ? 'bg-primary/15 text-primary' : isSlider ? 'bg-sky-500/15 text-sky-400' : isReorder ? 'bg-violet-500/15 text-violet-400' : isOpen ? 'bg-emerald-500/15 text-emerald-400' : isNew ? 'bg-pink-500/15 text-pink-400' : 'bg-amber-500/15 text-amber-400';

  const setMCOption = (i: number, val: string) => {
    const next = [...question.options];
    next[i] = val;
    onChange({ options: next });
  };
  const addOption = () => {
    if (question.options.length >= 6) return;
    onChange({ options: [...question.options, ''] });
  };
  const removeOption = (i: number) => {
    if (question.options.length <= 3) return;
    const next = question.options.filter((_, idx) => idx !== i);
    let correct = question.correct_index;
    if (correct >= next.length) correct = next.length - 1;
    if (i < correct) correct -= 1;
    onChange({ options: next, correct_index: correct });
  };

  return (
    <Card className="animate-slide-up">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-muted-foreground">Q{index + 1}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full', typeColor)}>
              {typeLabel}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} onClick={() => onMove(-1)}>
              <span className="text-xs">↑</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === total - 1} onClick={() => onMove(1)}>
              <span className="text-xs">↓</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDuplicate} title="Duplicate question" aria-label="Duplicate question">
              <Copy className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onRemove} title="Delete question" aria-label="Delete question">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={question.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder={isInfo ? 'Info text (e.g. "Part 2: History")' : question.type === 'blanks' ? 'The capital of {{France}} is {{Paris|Parigi}}' : isNew ? 'e.g. What is this monument?' : 'Type your question...'}
          className="text-base"
        />

        {isNew && <RevealSettings question={question} onChange={onChange} />}

        {/* Media field */}
        {!isNew && <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5" /> Media URL — image, audio (mp3/wav/ogg/flac/opus), YouTube (optional)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={question.video_url || question.audio_url || question.image_url}
              onChange={(e) => {
                const val = e.target.value;
                if (parseYouTubeId(val)) {
                  onChange({ video_url: val, audio_url: '', image_url: '' });
                } else if (/\.(mp3|wav|ogg|aac|m4a|flac|opus)(\?|$)/i.test(val)) {
                  onChange({ audio_url: val, video_url: '', image_url: '' });
                } else {
                  onChange({ image_url: val, video_url: '', audio_url: '' });
                }
              }}
              placeholder="https://youtube.com/… or audio.mp3 or image.jpg"
              className="flex-1 min-w-[200px]"
              aria-label="Media URL"
            />
            <UploadButton onUploaded={(url) => onChange({ image_url: url, video_url: '', audio_url: '' })} onError={setMediaError} />
            {question.video_url && parseYouTubeId(question.video_url) && (
              <>
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Start</label>
                <Input
                  type="text"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  onBlur={() => {
                    const ms = parseTimeInput(startTimeInput);
                    onChange({ video_start_ms: ms });
                    setStartTimeInput(formatTimeMs(ms));
                  }}
                  placeholder="mm:ss"
                  className="h-9 w-24 font-mono"
                />
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                  <Switch
                    checked={question.video_hidden}
                    onCheckedChange={(v) => onChange({ video_hidden: v })}
                  />
                  Hide video
                </label>
              </>
            )}
          </div>

          {mediaError && <p role="alert" className="text-xs text-destructive mt-1">{mediaError}</p>}

          {/* YouTube preview */}
          {question.video_url && parseYouTubeId(question.video_url) && (
            <div className="mt-2">
              <YouTubeEmbed url={question.video_url} startSeconds={Math.floor(question.video_start_ms / 1000)} />
            </div>
          )}

          {/* Direct audio preview + start time */}
          {question.audio_url && (
            <div className="mt-2 space-y-2">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={question.audio_url} className="w-full h-10 rounded-lg" />
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Start (mm:ss)</label>
                <Input
                  type="text"
                  value={audioStartTimeInput}
                  onChange={(e) => setAudioStartTimeInput(e.target.value)}
                  onBlur={() => {
                    const ms = parseTimeInput(audioStartTimeInput);
                    onChange({ audio_start_ms: ms });
                    setAudioStartTimeInput(formatTimeMs(ms));
                  }}
                  placeholder="00:00"
                  className="h-8 w-24 font-mono"
                />
              </div>
            </div>
          )}

          {/* Image preview */}
          {question.image_url && !parseYouTubeId(question.image_url) && (
            <div className="mt-2 rounded-lg overflow-hidden border border-border h-32 bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={question.image_url} alt="question" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          )}
        </div>}

        {(isMC || isTF) && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">
              Answer options — tap to mark correct
              {isMC && <span className="ml-2 text-muted-foreground/60">({question.options.length}/6, min 3)</span>}
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChange({ correct_index: i })}
                    className={cn(
                      'flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors',
                      OPTION_COLORS[i % OPTION_COLORS.length],
                      question.correct_index === i && 'ring-2 ring-primary'
                    )}
                  >
                    <span className={cn(
                      'w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                      question.correct_index === i ? 'bg-primary text-primary-foreground' : 'bg-background/50'
                    )}>
                      {question.correct_index === i ? <Check className="w-3 h-3" /> : String.fromCharCode(65 + i)}
                    </span>
                    {isTF ? (
                      <span className="text-sm font-medium">{opt}</span>
                    ) : (
                      <input
                        value={opt}
                        onChange={(e) => setMCOption(i, e.target.value)}
                        placeholder={`Option ${String.fromCharCode(65 + i)}`}
                        className="flex-1 bg-transparent outline-none text-sm"
                      />
                    )}
                  </button>
                  {!isTF && question.options.length > 3 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" onClick={() => removeOption(i)}>
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {!isTF && question.options.length < 6 && (
              <Button variant="ghost" size="sm" onClick={addOption} className="mt-2 gap-1.5 text-muted-foreground">
                <Plus className="w-3.5 h-3.5" /> Add option
              </Button>
            )}
            {isMC && (
              <label className="mt-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Switch checked={question.shuffle_options} onCheckedChange={(v) => onChange({ shuffle_options: v })} aria-label="Shuffle answer order" />
                Shuffle answer order in each game
              </label>
            )}
          </div>
        )}

        {isSlider && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Min value</label>
                <Input
                  type="number"
                  value={question.slider_min}
                  onChange={(e) => onChange({ slider_min: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Max value</label>
                <Input
                  type="number"
                  value={question.slider_max}
                  onChange={(e) => onChange({ slider_max: parseInt(e.target.value) || 100 })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Correct answer</label>
                <Input
                  type="number"
                  value={question.slider_answer}
                  onChange={(e) => onChange({ slider_answer: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="p-3 rounded-lg bg-card/50 border border-border">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <span>{question.slider_min}</span>
                <span className="text-emerald-400 font-bold">Answer: {question.slider_answer}</span>
                <span>{question.slider_max}</span>
              </div>
              <div className="relative h-2 rounded-full bg-card border border-border">
                <div className="absolute h-2 rounded-full bg-primary/30" style={{ width: '100%' }} />
                <div
                  className="absolute w-3 h-3 rounded-full bg-emerald-500 top-1/2 -translate-y-1/2 -translate-x-1/2"
                  style={{ left: `${((question.slider_answer - question.slider_min) / Math.max(1, question.slider_max - question.slider_min)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {isReorder && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Items to reorder ({question.options.length})</label>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={question.options.length <= 3}
                  onClick={() => {
                    const newOptions = question.options.slice(0, -1);
                    const newOrder = question.reorder_correct_order.filter((idx) => idx < newOptions.length);
                    const newImages = question.reorder_item_images.slice(0, -1);
                    onChange({ options: newOptions, reorder_correct_order: newOrder, reorder_item_images: newImages });
                  }}
                  className="h-7 px-2 text-xs gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Remove
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={question.options.length >= 10}
                  onClick={() => onChange({ options: [...question.options, ''], reorder_correct_order: [...question.reorder_correct_order, question.options.length], reorder_item_images: [...question.reorder_item_images, ''] })}
                  className="h-7 px-2 text-xs gap-1"
                >
                  <Plus className="w-3 h-3" /> Add item
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Set the items below in the CORRECT order. Players will see them shuffled. Each item can be either text or an image URL (jpg, png, webp, gif, avif, bmp, svg, heic) — not both.</p>
            {question.options.map((opt, i) => {
              const imgUrl = question.reorder_item_images[i] ?? '';
              const ALLOWED_EXT = /\.(jpg|jpeg|webp|png|gif|avif|bmp|svg|heic|heif)(\?|$)/i;
              const isImage = imgUrl.length > 0;
              const imgValid = imgUrl.length === 0 || ALLOWED_EXT.test(imgUrl);
              const value = isImage ? imgUrl : opt;
              return (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                  <Input
                    value={value}
                    onChange={(e) => {
                      const v = e.target.value;
                      const newOptions = [...question.options];
                      const newImages = [...question.reorder_item_images];
                      while (newImages.length <= i) newImages.push('');
                      if (ALLOWED_EXT.test(v)) {
                        newOptions[i] = '';
                        newImages[i] = v;
                      } else {
                        newOptions[i] = v;
                        newImages[i] = '';
                      }
                      onChange({ options: newOptions, reorder_item_images: newImages });
                    }}
                    placeholder={`Item ${i + 1} — text or image URL`}
                    className={cn('flex-1', isImage && !imgValid && 'border-destructive focus-visible:ring-destructive')}
                  />
                  {isImage && (
                    <ImageIcon className="w-4 h-4 text-violet-400 shrink-0" />
                  )}
                </div>
                {!imgValid && (
                  <p className="pl-8 text-xs text-destructive">Only jpg, png, webp, gif, avif, bmp, svg, heic allowed</p>
                )}
                {isImage && imgValid && (
                  <div className="pl-8">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imgUrl} alt="" className="h-16 rounded-lg object-cover border border-border" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} onLoad={(e) => { (e.target as HTMLImageElement).style.display = ''; }} />
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}

        {isOpen && <AcceptedAnswers answers={question.open_answers} onChange={(open_answers) => onChange({ open_answers })} />}

        {isInfo && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-muted-foreground">
              <Info className="w-4 h-4 inline mr-1.5 text-amber-400" />
              This is a display-only page. Players will see the text above, then the host continues to the next question. No scoring, no timer.
            </div>
            {question.image_url && !parseYouTubeId(question.image_url) && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Image position relative to text</label>
                <div className="flex gap-1.5">
                  {([
                    { pos: 'top', icon: <ArrowUp className="w-4 h-4" />, label: 'Above' },
                    { pos: 'bottom', icon: <ArrowDown className="w-4 h-4" />, label: 'Below' },
                    { pos: 'left', icon: <ArrowLeft className="w-4 h-4" />, label: 'Left' },
                    { pos: 'right', icon: <ArrowRightIcon className="w-4 h-4" />, label: 'Right' },
                  ] as const).map(({ pos, icon, label }) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => onChange({ info_image_position: pos })}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                        question.info_image_position === pos
                          ? 'border-amber-500/50 bg-amber-500/15 text-amber-400'
                          : 'border-border bg-card/40 text-muted-foreground hover:border-amber-500/30 hover:text-amber-400/70'
                      )}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!isInfo && (
          <ImageUrlField label="Picture shown with the answer (optional)" value={question.solution_image_url} onChange={(url) => onChange({ solution_image_url: url })} preview />
        )}

        {!isInfo && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center justify-between">
                <span>Time limit</span>
                <span className="font-bold text-foreground tabular-nums">{Math.round(question.time_limit_ms / 1000)}s</span>
              </label>
              <input
                type="range"
                min={5000}
                max={120000}
                step={5000}
                value={question.time_limit_ms}
                onChange={(e) => onChange({ time_limit_ms: parseInt(e.target.value) })}
                className="w-full h-2 rounded-full appearance-none cursor-pointer bg-card border border-border accent-primary mt-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                <span>5s</span>
                <span>60s</span>
                <span>120s</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Points {isSlider ? <span className="text-sky-400">(closer = more)</span> : isReorder ? <span className="text-violet-400">(% in the right place)</span> : isRevealType(question.type) ? <span className="text-pink-400">(less as the picture appears)</span> : question.type === 'blanks' ? <span className="text-pink-400">(% of right blanks)</span> : <span className="text-muted-foreground/60">(right answer)</span>}
              </label>
              <Input
                type="number"
                min={100}
                max={10000}
                step={100}
                value={question.points_value}
                onChange={(e) => onChange({ points_value: Math.max(100, parseInt(e.target.value) || 1000) })}
                className="h-9"
              />
            </div>
            <PointsDecayField question={question} onChange={onChange} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** When points start going down: full points before, then down to 0 at the time limit. */
function PointsDecayField({ question, onChange }: { question: QuestionDraft; onChange: (patch: Partial<QuestionDraft>) => void }) {
  const limit = question.time_limit_ms;
  const start = Math.min(limit, decayStartMs(question) ?? limit);
  const never = start >= limit;
  const after = isRevealType(question.type) ? 'then fewer as more of the picture shows' : `then down to 0 at ${Math.round(limit / 1000)}s`;
  return (
    <div className="col-span-2">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center justify-between gap-3">
        <span>Full points for the first</span>
        <span className="font-bold text-foreground tabular-nums text-right">
          {never ? 'whole time — speed does not matter' : `${Math.round(start / 1000)}s, ${after}`}
        </span>
      </label>
      <input
        type="range"
        aria-label="Full points for the first seconds"
        min={0}
        max={limit}
        step={1000}
        value={start}
        onChange={(e) => onChange({ points_decay_start_ms: parseInt(e.target.value) })}
        className="w-full accent-primary"
      />
    </div>
  );
}
