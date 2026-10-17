'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Zap, Trophy, Users, MoreVertical, Play, ArrowRight, MonitorPlay, Home, Trash2, LogOut, User, UserX, Globe, Lock, Twitter, Facebook, Upload } from 'lucide-react';
import { supabase, type Quiz, getGuestSession, clearGuestSession, addGuestQuizId, removeGuestQuizId } from '@/lib/supabase';
import { createSession } from '@/lib/game-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { ImportQuizDialog } from '@/components/import-quiz-dialog';
import { type ParsedQuiz } from '@/lib/quiz-import';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

type QuizWithCount = Quiz & { question_count: number; first_question_image?: string | null };

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [quizzes, setQuizzes] = useState<QuizWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; nickname: string } | null>(null);
  const [guestNickname, setGuestNickname] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<QuizWithCount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingPublic, setTogglingPublic] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const isGuest = !!guestNickname;

  // Clean up guest quizzes when the tab/window is closed
  useEffect(() => {
    const cleanup = () => {
      const session = getGuestSession();
      if (!session || session.quizIds.length === 0) return;
      const ids = session.quizIds;
      // Use sendBeacon or synchronous fetch for cleanup (best-effort)
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
      const url = `${supabaseUrl}/rest/v1/quizzes?id=in.(${ids.join(',')})&is_guest=eq.true`;
      navigator.sendBeacon(url + `&apikey=${supabaseKey}`, '');
    };
    window.addEventListener('beforeunload', cleanup);
    return () => window.removeEventListener('beforeunload', cleanup);
  }, []);

  useEffect(() => {
    const guest = getGuestSession();
    if (guest) {
      setGuestNickname(guest.nickname);
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        const meta = data.session.user.user_metadata;
        setCurrentUser({ id: data.session.user.id, nickname: meta?.nickname ?? 'User' });
      } else {
        router.push('/');
      }
      setAuthLoading(false);
    });
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    const guest = getGuestSession();

    if (guest) {
      // Guest: load only their quizzes by ID
      if (guest.quizIds.length === 0) {
        setQuizzes([]);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('quizzes')
        .select('id, title, description, cover_image_url, created_by, created_at, is_public, is_guest')
        .in('id', guest.quizIds)
        .order('created_at', { ascending: false });
      if (error) {
        toast({ title: 'Failed to load quizzes', description: error.message, variant: 'destructive' });
        setLoading(false);
        return;
      }
      const list = (data || []) as Quiz[];
      const counts = await Promise.all(
        list.map(async (q) => {
          const [{ count }, { data: firstQ }] = await Promise.all([
            supabase.from('questions').select('id', { count: 'exact', head: true }).eq('quiz_id', q.id),
            supabase.from('questions').select('image_url').eq('quiz_id', q.id).order('position', { ascending: true }).limit(1).maybeSingle(),
          ]);
          return { ...q, question_count: count ?? 0, first_question_image: firstQ?.image_url ?? null };
        })
      );
      setQuizzes(counts);
      setLoading(false);
      return;
    }

    // Authenticated user: load their own quizzes
    const { data, error } = await supabase
      .from('quizzes')
      .select('id, title, description, cover_image_url, created_by, created_at, is_public, owner_id')
      .eq('owner_id', currentUser?.id ?? '')
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Failed to load quizzes', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const list2 = (data || []) as Quiz[];
    const counts2 = await Promise.all(
      list2.map(async (q) => {
        const [{ count }, { data: firstQ }] = await Promise.all([
          supabase.from('questions').select('id', { count: 'exact', head: true }).eq('quiz_id', q.id),
          supabase.from('questions').select('image_url').eq('quiz_id', q.id).order('position', { ascending: true }).limit(1).maybeSingle(),
        ]);
        return { ...q, question_count: count ?? 0, first_question_image: firstQ?.image_url ?? null };
      })
    );
    setQuizzes(counts2);
    setLoading(false);
  }, [toast, currentUser]);

  useEffect(() => {
    if (!authLoading) load();
  }, [load, authLoading]);

  const createQuiz = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);

    const guest = getGuestSession();
    const insertData: Record<string, unknown> = {
      title: newTitle.trim(),
      description: newDesc.trim() || null,
      created_by: guest ? guest.nickname : (currentUser?.nickname ?? null),
    };
    if (guest) {
      insertData.is_guest = true;
      // owner_id intentionally omitted (null) for guest quizzes
    }

    const { data, error } = await supabase
      .from('quizzes')
      .insert(insertData)
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast({ title: 'Failed to create quiz', description: error?.message, variant: 'destructive' });
      return;
    }
    if (guest) {
      addGuestQuizId(data.id);
    }
    setCreateOpen(false);
    setNewTitle('');
    setNewDesc('');
    router.push(`/dashboard/${data.id}`);
  };

  const handleImportQuiz = async (parsed: ParsedQuiz) => {
    const guest = getGuestSession();
    const insertData: Record<string, unknown> = {
      title: parsed.title,
      description: parsed.description || null,
      created_by: guest ? guest.nickname : (currentUser?.nickname ?? null),
    };
    if (guest) insertData.is_guest = true;

    const { data: quizRow, error: quizErr } = await supabase
      .from('quizzes')
      .insert(insertData)
      .select()
      .single();
    if (quizErr || !quizRow) {
      toast({ title: 'Failed to create quiz', description: quizErr?.message, variant: 'destructive' });
      throw quizErr;
    }
    if (guest) addGuestQuizId(quizRow.id);

    const questionRows = parsed.questions.map((q, i) => ({
      quiz_id: quizRow.id,
      position: i,
      type: q.type,
      prompt: q.prompt,
      options: q.type === 'tf' ? ['True', 'False'] : q.type === 'mc' ? q.options : q.type === 'reorder' ? q.options : [],
      correct_index: q.type === 'tf' ? q.correct_index : q.type === 'mc' ? q.correct_index : 0,
      image_url: null,
      video_url: null,
      video_start_ms: 0,
      video_hidden: false,
      video_volume: 1.0,
      audio_url: null,
      audio_volume: 0.5,
      audio_start_ms: 0,
      audio_hidden: false,
      time_limit_ms: q.time_limit_ms,
      slider_min: q.type === 'slider' ? q.slider_min : null,
      slider_max: q.type === 'slider' ? q.slider_max : null,
      slider_answer: q.type === 'slider' ? q.slider_answer : null,
      reorder_correct_order: q.type === 'reorder' ? q.options.map((_, idx) => idx) : null,
      reorder_item_images: q.type === 'reorder' ? q.options.map(() => '') : null,
      open_answers: q.type === 'open' ? q.open_answers : null,
      points_value: q.points_value,
      info_image_position: 'top',
    }));

    const { error: qErr } = await supabase.from('questions').insert(questionRows);
    if (qErr) {
      await supabase.from('quizzes').delete().eq('id', quizRow.id);
      if (guest) removeGuestQuizId(quizRow.id);
      toast({ title: 'Import failed', description: qErr.message, variant: 'destructive' });
      throw qErr;
    }
    toast({ title: 'Quiz imported', description: `${parsed.questions.length} questions added to "${parsed.title}"` });
    load();
  };

  const startPractice = (quiz: QuizWithCount) => {
    if (quiz.question_count === 0) {
      toast({ title: 'Add at least one question first', variant: 'destructive' });
      return;
    }
    router.push(`/practice/${quiz.id}`);
  };

  const startSession = async (quiz: QuizWithCount) => {
    if (quiz.question_count === 0) {
      toast({ title: 'Add at least one question first', variant: 'destructive' });
      return;
    }
    const { session, error } = await createSession(quiz.id);
    if (error || !session) {
      toast({ title: 'Failed to start session', description: error?.message, variant: 'destructive' });
      return;
    }
    router.push(`/host/${session.id}`);
  };

  const handleLogout = async () => {
    const guest = getGuestSession();
    if (guest) {
      // Delete guest quizzes from Supabase before clearing session
      if (guest.quizIds.length > 0) {
        await supabase.from('questions').delete().in('quiz_id', guest.quizIds);
        await supabase.from('quizzes').delete().in('id', guest.quizIds).eq('is_guest', true);
      }
      clearGuestSession();
    } else {
      await supabase.auth.signOut();
    }
    router.push('/');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error: qErr } = await supabase.from('questions').delete().eq('quiz_id', deleteTarget.id);
    if (qErr) {
      toast({ title: 'Failed to delete questions', description: qErr.message, variant: 'destructive' });
      setDeleting(false);
      return;
    }
    const { error } = await supabase.from('quizzes').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast({ title: 'Failed to delete quiz', description: error.message, variant: 'destructive' });
      return;
    }
    if (isGuest) removeGuestQuizId(deleteTarget.id);
    toast({ title: 'Quiz deleted' });
    setDeleteTarget(null);
    load();
  };

  const togglePublic = async (quiz: QuizWithCount) => {
    if (isGuest) return;
    setTogglingPublic(quiz.id);
    const newValue = !quiz.is_public;
    const { error } = await supabase
      .from('quizzes')
      .update({ is_public: newValue })
      .eq('id', quiz.id);
    setTogglingPublic(null);
    if (error) {
      toast({ title: 'Failed to update visibility', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: newValue ? 'Quiz is now public' : 'Quiz is now private' });
    load();
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  }

  const displayName = guestNickname ?? currentUser?.nickname;

  return (
    <div className="min-h-screen bg-grid relative">
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" title="Home"><Home className="w-4 h-4" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">My Quizzes</h1>
              <p className="text-sm text-muted-foreground">
                {isGuest ? 'Guest session — quizzes lost on tab close.' : 'Create, edit, and host live quiz games.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {displayName && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${isGuest ? 'bg-amber-500/10 border-amber-500/30' : 'bg-primary/10 border-primary/20'}`}>
                {isGuest ? <UserX className="w-4 h-4 text-amber-500" /> : <User className="w-4 h-4 text-primary" />}
                <span className="text-sm font-medium">{displayName}</span>
                {isGuest && <span className="text-xs text-amber-500/80 hidden sm:inline">Guest</span>}
              </div>
            )}
            {!isGuest && (
              <Link href="/library">
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                  <Globe className="w-4 h-4" /> Browse quizzes
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Log out">
              <LogOut className="w-4 h-4" />
            </Button>
            <VolumeControl />
            <ThemeSwitcher />
            <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
              <Upload className="w-4 h-4" /> Import
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> New quiz
            </Button>
          </div>
        </div>

        {isGuest && (
          <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
            <UserX className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-600">Guest mode active</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your quizzes are saved temporarily. They will be deleted when you close or refresh this tab.
                <Link href="/" className="text-primary underline ml-1">Create an account</Link> to save them permanently.
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 rounded-xl bg-card/40 border border-border animate-pulse" />
            ))}
          </div>
        ) : quizzes.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/15 text-primary flex items-center justify-center mx-auto mb-4">
                <Trophy className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-semibold mb-1">No quizzes yet</h3>
              <p className="text-muted-foreground text-sm mb-4">Create your first quiz to start hosting live games.</p>
              <Button onClick={() => setCreateOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" /> Create a quiz
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quizzes.map((quiz) => {
              const coverImg = quiz.cover_image_url || quiz.first_question_image;
              return (
              <Card key={quiz.id} className="group hover:border-primary/40 transition-colors overflow-hidden flex flex-col">
                {/* Cover image */}
                {coverImg && (
                  <div className="h-36 overflow-hidden bg-card border-b border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={coverImg} alt={quiz.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                  </div>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{quiz.title}</CardTitle>
                      {quiz.created_by && (
                        <span className="text-xs text-primary font-medium mt-1 flex items-center gap-1">
                          <Users className="w-3 h-3" /> {quiz.created_by}
                        </span>
                      )}
                      {quiz.description && (
                        <CardDescription className="truncate mt-1">{quiz.description}</CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            const url = `${window.location.origin}/practice/${quiz.id}`;
                            const text = encodeURIComponent(`Try this quiz: ${quiz.title}`);
                            window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
                          }}
                        >
                          <Twitter className="w-4 h-4 mr-2" /> Share on X / Twitter
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const url = encodeURIComponent(`${window.location.origin}/practice/${quiz.id}`);
                            window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener');
                          }}
                        >
                          <Facebook className="w-4 h-4 mr-2" /> Share on Facebook
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(quiz)}>
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 flex flex-col gap-3 mt-auto">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5" /> {quiz.question_count} questions
                    </span>
                    {!isGuest && (
                      <div className="flex items-center gap-2">
                        <span className={quiz.is_public ? 'text-emerald-400 flex items-center gap-1' : 'flex items-center gap-1'}>
                          {quiz.is_public ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                          {quiz.is_public ? 'Public' : 'Private'}
                        </span>
                        <Switch
                          checked={!!quiz.is_public}
                          disabled={togglingPublic === quiz.id}
                          onCheckedChange={() => togglePublic(quiz)}
                          aria-label="Toggle public"
                          className="scale-75 origin-right"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => router.push(`/dashboard/${quiz.id}`)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => startPractice(quiz)}>
                      <MonitorPlay className="w-3.5 h-3.5" /> Practice
                    </Button>
                    <Button size="sm" className="flex-1 gap-1.5" onClick={() => startSession(quiz)}>
                      <Play className="w-3.5 h-3.5" /> Host
                    </Button>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new quiz</DialogTitle>
            <DialogDescription>Give your quiz a name. You can add questions next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Title</label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. World Capitals"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && createQuiz()}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="A short description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createQuiz} disabled={!newTitle.trim() || creating} className="gap-2">
              {creating ? 'Creating...' : <>Create <ArrowRight className="w-4 h-4" /></>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.title}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the quiz and all its questions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportQuizDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImportQuiz}
      />
    </div>
  );
}
