import { describe, expect, it } from 'vitest';
import {
  blankHint, blankPrompt, blockyConfig, computeBlanksPoints, computeRevealPoints, defaultRevealConfig, dezoomConfig,
  dezoomLevel, parseBlanks, revealProgress, revealedTiles, tileOrder,
} from '@/lib/reveal';
import { parseQuizText } from '@/lib/quiz-import';
import type { Question } from '@/lib/supabase';

const q = (over: Partial<Question>) => ({ time_limit_ms: 20000, points_value: 1000, open_answers: ['Colosseo'], reveal_config: null, ...over }) as Question;

describe('settings', () => {
  it('fills in defaults and keeps values inside their limits', () => {
    expect(dezoomConfig({ reveal_config: null })).toEqual({ start_zoom: 8, end_zoom: 1, focus_x: 0.5, focus_y: 0.5 });
    expect(dezoomConfig({ reveal_config: { start_zoom: 50, end_zoom: 30, focus_x: -1, focus_y: 2 } })).toEqual({ start_zoom: 20, end_zoom: 20, focus_x: 0, focus_y: 1 });
    expect(blockyConfig({ reveal_config: { grid: 40, tiles_per_step: 999, step_ms: 1, order: 'bad' as never } })).toEqual({
      grid: 12, tiles_per_step: 144, step_ms: 500, order: 'random', style: 'pixel',
    });
    expect(defaultRevealConfig('blanks')).toEqual({ hint: 'none' });
    expect(defaultRevealConfig('mc')).toEqual({});
  });
});

describe('dezoom', () => {
  it('zooms out steadily from the start zoom to the end zoom', () => {
    const c = dezoomConfig({ reveal_config: { start_zoom: 16, end_zoom: 1 } });
    expect(dezoomLevel(c, 0)).toBe(16);
    expect(dezoomLevel(c, 0.5)).toBeCloseTo(4);
    expect(dezoomLevel(c, 1)).toBe(1);
  });

  it('earlier right answers get more points, never less than 10%', () => {
    const d = q({ type: 'dezoom' });
    expect(computeRevealPoints(d, 'colosseo', 0)).toEqual({ points: 1000, isCorrect: true });
    expect(computeRevealPoints(d, 'Colosseo', 5000).points).toBe(750);
    expect(computeRevealPoints(d, 'Colosseo', 25000).points).toBe(100);
    expect(computeRevealPoints(d, 'Pantheon', 0)).toEqual({ points: 0, isCorrect: false });
  });
});

describe('blocky', () => {
  const c = blockyConfig({ reveal_config: { grid: 4, tiles_per_step: 3, step_ms: 2000 } });

  it('shows a few more squares every few seconds', () => {
    expect([0, 1999, 2000, 4100, 60000].map((t) => revealedTiles(c, t))).toEqual([0, 0, 3, 6, 16]);
    expect(revealProgress(q({ type: 'blocky', reveal_config: c }), 4100)).toBe(6 / 16);
  });

  it('the order holds every square once and is the same for everyone', () => {
    for (const order of ['random', 'spiral', 'edges'] as const) {
      const a = tileOrder(5, order, 'question-1');
      expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i));
      expect(tileOrder(5, order, 'question-1')).toEqual(a);
    }
    expect(tileOrder(5, 'random', 'question-1')).not.toEqual(tileOrder(5, 'random', 'question-2'));
  });

  it('centre outwards starts in the middle, edges inwards ends there', () => {
    expect(tileOrder(5, 'spiral', 'x')[0]).toBe(12);
    expect(tileOrder(5, 'edges', 'x')[24]).toBe(12);
  });
});

describe('fill the blanks', () => {
  const prompt = 'La capitale della {{Francia|France}} è {{ Parigi }}.';

  it('reads the gaps and their accepted answers', () => {
    expect(parseBlanks(prompt)).toEqual({ parts: ['La capitale della ', 0, ' è ', 1, '.'], answers: [['Francia', 'France'], ['Parigi']] });
    expect(blankPrompt(prompt)).toBe('La capitale della ____ è ____.');
    expect(parseBlanks('no gaps').answers).toEqual([]);
  });

  it('hints show the length or the first letter', () => {
    expect(blankHint(['Parigi'], 'none')).toBe('');
    expect(blankHint(['Parigi'], 'length')).toBe('_ _ _ _ _ _');
    expect(blankHint(['New York'], 'first')).toBe('N _ _   _ _ _ _');
  });

  it('each right gap is worth its share, typos and accents are forgiven', () => {
    const b = q({ type: 'blanks', prompt });
    expect(computeBlanksPoints(b, ['france', 'parigi'], 1000)).toEqual({ points: 1000, isCorrect: true, right: [true, true] });
    expect(computeBlanksPoints(b, ['Spagna', 'Parigi'], 1000)).toEqual({ points: 500, isCorrect: false, right: [false, true] });
    expect(computeBlanksPoints(b, ['Francia', 'Parigi'], 11500).points).toBe(500);
    expect(computeBlanksPoints(b, [], 0).points).toBe(0);
  });
});

describe('import format', () => {
  it('reads de-zoom, blocky and blanks questions with their settings', () => {
    const res = parseQuizText(`# Nuovi tipi

Q: Che monumento è?
T: dezoom
Image: https://x.test/c.jpg
Zoom: 12 -> 2
Focus: 30, 60
A: Colosseo
A: Colosseum

Q: Che quadro è?
T: blocky
Image: https://x.test/m.jpg
Grid: 5
Reveal: 2 every 3
Order: spiral
Style: blur
A: Gioconda

Q: La capitale della {{Francia}} è {{Parigi}}
T: blanks
Hint: first`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [d, b, f] = res.quiz.questions;
    expect(d).toMatchObject({ type: 'dezoom', image_url: 'https://x.test/c.jpg', open_answers: ['Colosseo', 'Colosseum'], reveal_config: { start_zoom: 12, end_zoom: 2, focus_x: 0.3, focus_y: 0.6 } });
    expect(b).toMatchObject({ type: 'blocky', reveal_config: { grid: 5, tiles_per_step: 2, step_ms: 3000, order: 'spiral', style: 'blur' } });
    expect(f).toMatchObject({ type: 'blanks', image_url: null, open_answers: [], reveal_config: { hint: 'first' } });
  });

  it('explains what is missing', () => {
    const noImage = parseQuizText('# T\n\nQ: Cosa?\nT: dezoom\nA: x');
    expect(!noImage.ok && noImage.error).toContain('Image:');
    const noAnswer = parseQuizText('# T\n\nQ: Cosa?\nT: blocky\nImage: https://x.test/a.jpg');
    expect(!noAnswer.ok && noAnswer.error).toContain('accepted answer');
    const tooMany = parseQuizText('# T\n\nQ: {{a}} {{b}} {{c}} {{d}} {{e}} {{f}}\nT: blanks');
    expect(!tooMany.ok && tooMany.error).toContain('1 to 5 blanks');
    const bad = parseQuizText('# T\n\nQ: {{a}}\nT: blanks\nHint: maybe');
    expect(!bad.ok && bad.error).toContain('not a valid setting');
  });
});
