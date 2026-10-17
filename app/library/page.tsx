'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, Search, Globe, Users, Home, Play, MonitorPlay, ArrowRight, BookOpen } from 'lucide-react';
import { supabase, type Quiz, getGuestSession } from '@/lib/supabase';
import { createSession } from '@/lib/game-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { useToast } from '@/hooks/use-toast';

type QuizWithCount = Quiz & { question_count: number };

export default function LibraryPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [quizzes, setQuizzes] = useState<QuizWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('quizzes')
      .select('id, title, description, cover_image_url, created_by, created_at, is_public')
      .eq('is_public', true)
      .eq('is_guest', false)
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Failed to load library', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const list = (data || []) as Quiz[];
    const counts = await Promise.all(
      list.map(async (q) => {
        const { count } = await supabase
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('quiz_id', q.id);
        return { ...q, question_count: count ?? 0 };
      })
    );
    setQuizzes(counts);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const startPractice = (quiz: QuizWithCount) => {
    if (quiz.question_count === 0) {
      toast({ title: 'This quiz has no questions yet', variant: 'destructive' });
      return;
    }
    router.push(`/practice/${quiz.id}`);
  };

  const startSession = async (quiz: QuizWithCount) => {
    if (quiz.question_count === 0) {
      toast({ title: 'This quiz has no questions yet', variant: 'destructive' });
      return;
    }
    const { session, error } = await createSession(quiz.id);
    if (error || !session) {
      toast({ title: 'Failed to start session', description: error?.message, variant: 'destructive' });
      return;
    }
    router.push(`/host/${session.id}`);
  };

  const filtered = search.trim()
    ? quizzes.filter(
        (q) =>
          q.title.toLowerCase().includes(search.toLowerCase()) ||
          (q.description ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (q.created_by ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : quizzes;

  const guest = typeof window !== 'undefined' ? getGuestSession() : null;
  const isGuest = !!guest;

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
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Globe className="w-6 h-6 text-primary" /> Public Library
              </h1>
              <p className="text-sm text-muted-foreground">Browse and play quizzes shared by the community.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <VolumeControl />
            <ThemeSwitcher />
            <Link href="/dashboard">
              <Button variant="ghost" className="gap-2">
                My Quizzes <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, description, or author..."
            className="pl-10 h-11"
          />
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-44 rounded-xl bg-card/40 border border-border animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/15 text-primary flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-semibold mb-1">
                {search ? 'No results found' : 'No public quizzes yet'}
              </h3>
              <p className="text-muted-foreground text-sm mb-4">
                {search
                  ? 'Try a different search term.'
                  : 'Be the first to share a quiz with the community! Go to your dashboard and set a quiz as public.'}
              </p>
              {!search && (
                <Link href="/dashboard">
                  <Button className="gap-2">
                    <ArrowRight className="w-4 h-4" /> Go to Dashboard
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">{filtered.length} quiz{filtered.length !== 1 ? 'zes' : ''}</p>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((quiz) => (
                <Card key={quiz.id} className="group hover:border-primary/40 transition-colors">
                  {quiz.cover_image_url && (
                    <div className="h-32 overflow-hidden rounded-t-xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={quiz.cover_image_url}
                        alt={quiz.title}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                      />
                    </div>
                  )}
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate">{quiz.title}</CardTitle>
                        {quiz.created_by && (
                          <span className="text-xs text-primary font-medium mt-1 flex items-center gap-1">
                            <Users className="w-3 h-3" /> {quiz.created_by}
                          </span>
                        )}
                        {quiz.description && (
                          <CardDescription className="line-clamp-2 mt-1">{quiz.description}</CardDescription>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                      <span className="flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" /> {quiz.question_count} questions
                      </span>
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Globe className="w-3 h-3" /> Public
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => startPractice(quiz)}>
                        <MonitorPlay className="w-3.5 h-3.5" /> Practice
                      </Button>
                      <Button size="sm" className="flex-1 gap-1.5" onClick={() => startSession(quiz)}>
                        <Play className="w-3.5 h-3.5" /> Host
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
