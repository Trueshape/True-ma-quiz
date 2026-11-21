import { describe, expect, it } from 'vitest';
import {
  blankHint, blankPrompt, blanksConfig, blockyConfig, blockyTotal, computeBlanksPoints, computeRevealPoints, defaultRevealConfig,
  dezoomConfig, dezoomLevel, extraLetters, parseBlanks, revealProgress, revealedTiles, squareGrid, tileOrder,
} from '@/lib/reveal';
import { computeOpenPoints, computePoints, computeReorderPoints, computeSliderPoints, decayStartMs, type Question } from '@/lib/supabase';
import { parseQuizText } from '@/lib/quiz-import';

const q = (over: Partial<Question>) =>
  ({ time_limit_ms: 20000, points_value: 1000, open_answers: ['Colosseo'], reveal_config: null, points_decay_start_ms: null, ...over }) as Question;

describe('settings', () => {
  it('fills in defaults and keeps values inside their limits', () => {
    expect(dezoomConfig({ reveal_config: null })).toEqual({ start_zoom: 8, end_zoom: 1, focus_x: 0.5, focus_y: 0.5 });
    expect(dezoomConfig({ reveal_config: { start_zoom: 50, end_zoom: 30, focus_x: -1, focus_y: 2 } })).toEqual({ start_zoom: 20, end_zoom: 20, focus_x: 0, focus_y: 1 });
    expect(blockyConfig({ reveal_config: { tiles: 999, tiles_per_step: 999, step_ms: 1, order: 'bad' as never, blur: 9 } })).toEqual({
      tiles: 144, cols: null, rows: null, tiles_per_step: 144, step_ms: 500, order: 'random', style: 'pixel', blur: 5,
    });
    expect(defaultRevealConfig('blocky')).toEqual({ tiles: 36, tiles_per_step: 3, step_ms: 2000, order: 'random', style: 'pixel', blur: 3 });
    expect(defaultRevealConfig('blanks')).toEqual({ hint: 'none', letter_every_ms: 0 });
    expect(defaultRevealConfig('mc')).toEqual({});
  });
});

describe('when points start going down', () => {
  it('each type keeps its usual rule unless the creator sets one', () => {
    expect(decayStartMs(q({ type: 'mc' }))).toBe(3000);
    expect(decayStartMs(q({ type: 'slider' }))).toBeNull();
    expect(decayStartMs(q({ type: 'blocky' }))).toBe(0);
    expect(decayStartMs(q({ type: 'reorder', points_decay_start_ms: 5000 }))).toBe(5000);
  });

  it('full points until then, down to 0 at the time limit; at the limit or past it, never', () => {
    expect(computePoints(true, 9000, 20000, 1000, 10000)).toBe(1000);
    expect(computePoints(true, 15000, 20000, 1000, 10000)).toBe(500);
    expect(computePoints(true, 20000, 20000, 1000, 20000)).toBe(1000);
    expect(computePoints(true, 21000, 20000, 1000, 25000)).toBe(1000);
    expect(computeOpenPoints('colosseo', ['Colosseo'], 1000, 15000, 20000, 0).points).toBe(250);
  });

  it('slider and reorder only count time when asked to', () => {
    expect(computeSliderPoints(50, 50, 0, 100, 1000, 15000, 20000)).toBe(1000);
    expect(computeSliderPoints(50, 50, 0, 100, 1000, 15000, 20000, 10000)).toBe(500);
    expect(computeReorderPoints([0, 1], [0, 1], 1000, 15000, 20000)).toBe(1000);
    expect(computeReorderPoints([0, 1], [0, 1], 1000, 15000, 20000, 10000)).toBe(500);
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

  it('with full points for the first seconds, the drop starts from there', () => {
    const d = q({ type: 'dezoom', points_decay_start_ms: 10000 });
    expect(computeRevealPoints(d, 'Colosseo', 9000).points).toBe(1000);
    // at 15 s, 75% shown; at 10 s, 50% shown: (1 - 0.75) / (1 - 0.5) = 50%
    expect(computeRevealPoints(d, 'Colosseo', 15000).points).toBe(500);
    expect(computeRevealPoints(q({ type: 'dezoom', points_decay_start_ms: 20000 }), 'Colosseo', 19000).points).toBe(1000);
  });
});

describe('blocky', () => {
  const c = blockyConfig({ reveal_config: { tiles: 16, cols: 4, rows: 4, tiles_per_step: 3, step_ms: 2000 } });

  it('shows a few more tiles every few seconds', () => {
    expect([0, 1999, 2000, 4100, 60000].map((t) => revealedTiles(c, t))).toEqual([0, 0, 3, 6, 16]);
    expect(revealProgress(q({ type: 'blocky', reveal_config: { tiles: 16, cols: 4, rows: 4, tiles_per_step: 3, step_ms: 2000 } }), 4100)).toBe(6 / 16);
  });

  it('picks columns and rows that make square tiles for the picture', () => {
    expect(squareGrid(36, 1000, 1000)).toEqual({ cols: 6, rows: 6 });
    expect(squareGrid(36, 600, 1200)).toEqual({ cols: 4, rows: 9 });
    expect(squareGrid(40, 1600, 900)).toEqual({ cols: 8, rows: 5 });
  });

  it('the points count the saved grid, or the tiles asked for, or an older square grid', () => {
    expect(blockyTotal(blockyConfig({ reveal_config: { tiles: 36, cols: 4, rows: 9 } }))).toBe(36);
    expect(blockyTotal(blockyConfig({ reveal_config: { tiles: 40 } }))).toBe(40);
    expect(blockyTotal(blockyConfig({ reveal_config: { grid: 5 } }))).toBe(25);
  });

  it('the order holds every tile once and is the same for everyone', () => {
    for (const order of ['random', 'spiral', 'edges'] as const) {
      const a = tileOrder(4, 6, order, 'question-1');
      expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 24 }, (_, i) => i));
      expect(tileOrder(4, 6, order, 'question-1')).toEqual(a);
    }
    expect(tileOrder(5, 5, 'random', 'question-1')).not.toEqual(tileOrder(5, 5, 'random', 'question-2'));
  });

  it('centre outwards starts in the middle, edges inwards ends there', () => {
    expect(tileOrder(5, 5, 'spiral', 'x')[0]).toBe(12);
    expect(tileOrder(5, 5, 'edges', 'x')[24]).toBe(12);
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

  it('more letters appear over time, never the last one', () => {
    const c = blanksConfig({ reveal_config: { hint: 'none', letter_every_ms: 5000 } });
    expect([0, 4999, 5000, 12000].map((t) => extraLetters(c, t))).toEqual([0, 0, 1, 2]);
    expect(blankHint(['Parigi'], 'none', 0)).toBe('');
    expect(blankHint(['Parigi'], 'none', 2)).toBe('P a _ _ _ _');
    expect(blankHint(['Parigi'], 'first', 2)).toBe('P a r _ _ _');
    expect(blankHint(['Roma'], 'first', 10)).toBe('R o m _');
    expect(blankHint(['New York'], 'none', 4)).toBe('N e w   Y _ _ _');
    expect(extraLetters(blanksConfig({ reveal_config: null }), 60000)).toBe(0);
  });

  it('each right gap is worth its share, typos and accents are forgiven', () => {
    const b = q({ type: 'blanks', prompt });
    expect(computeBlanksPoints(b, ['france', 'parigi'], 1000)).toEqual({ points: 1000, isCorrect: true, right: [true, true] });
    expect(computeBlanksPoints(b, ['Spagna', 'Parigi'], 1000)).toEqual({ points: 500, isCorrect: false, right: [false, true] });
    expect(computeBlanksPoints(b, ['Francia', 'Parigi'], 11500).points).toBe(500);
    expect(computeBlanksPoints({ ...b, points_decay_start_ms: 20000 }, ['Francia', 'Parigi'], 11500).points).toBe(1000);
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
Full: 4
A: Colosseo
A: Colosseum

Q: Che quadro è?
T: blocky
Image: https://x.test/m.jpg
Tiles: 40
Reveal: 2 every 3
Order: spiral
Style: blur
Blur: 4
A: Gioconda

Q: La capitale della {{Francia}} è {{Parigi}}
T: blanks
Hint: first
Letters: 5`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [d, b, f] = res.quiz.questions;
    expect(d).toMatchObject({ type: 'dezoom', image_url: 'https://x.test/c.jpg', open_answers: ['Colosseo', 'Colosseum'], points_decay_start_ms: 4000, reveal_config: { start_zoom: 12, end_zoom: 2, focus_x: 0.3, focus_y: 0.6 } });
    expect(b).toMatchObject({ type: 'blocky', points_decay_start_ms: null, reveal_config: { tiles: 40, tiles_per_step: 2, step_ms: 3000, order: 'spiral', style: 'blur', blur: 4 } });
    expect(f).toMatchObject({ type: 'blanks', image_url: null, open_answers: [], reveal_config: { hint: 'first', letter_every_ms: 5000 } });
  });

  it('an older "Grid" line becomes the same number of tiles', () => {
    const res = parseQuizText('# T\n\nQ: ?\nT: blocky\nImage: https://x.test/a.jpg\nGrid: 5\nA: x');
    expect(res.ok && res.quiz.questions[0].reveal_config).toMatchObject({ tiles: 25 });
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
