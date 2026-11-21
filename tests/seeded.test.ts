import { describe, expect, it } from 'vitest';
import { originalOption, seededOrder, shuffleOptions } from '@/lib/seeded';
import { blockyConfig } from '@/lib/reveal';
import type { Question } from '@/lib/supabase';

const mc = (over: Partial<Question> = {}) =>
  ({ id: 'q1', type: 'mc', options: ['Roma', 'Parigi', 'Berlino', 'Madrid'], correct_index: 1, shuffle_options: true, ...over }) as Question;

describe('shuffled answers', () => {
  it('the same game shows the same order on every device, another game a different one', () => {
    expect(seededOrder(6, 'game-1:q1')).toEqual(seededOrder(6, 'game-1:q1'));
    const games = new Set(Array.from({ length: 10 }, (_, g) => seededOrder(6, `game-${g}:q1`).join()));
    expect(games.size).toBeGreaterThan(1);
  });

  it('keeps the right answer right, and sends the original index to the server', () => {
    for (let g = 0; g < 20; g++) {
      const shown = shuffleOptions(mc(), `game-${g}:q1`);
      expect([...shown.options].sort()).toEqual(['Berlino', 'Madrid', 'Parigi', 'Roma']);
      expect(shown.options[shown.correct_index]).toBe('Parigi');
      expect(originalOption(shown, shown.correct_index)).toBe(1);
      shown.options.forEach((text, i) => expect(mc().options[originalOption(shown, i)]).toBe(text));
    }
  });

  it('leaves other questions alone', () => {
    expect(shuffleOptions(mc({ shuffle_options: false }), 's')).toEqual(mc({ shuffle_options: false }));
    expect(shuffleOptions(mc({ type: 'tf', options: ['True', 'False'] }), 's').option_order).toBeUndefined();
    expect(originalOption(mc({ shuffle_options: false }), 2)).toBe(2);
  });
});

describe('hidden tile styles', () => {
  it('accepts the new styles and falls back to pixelated', () => {
    for (const style of ['pixel', 'blur', 'solid', 'shuffle', 'cards', 'noise'] as const) {
      expect(blockyConfig({ reveal_config: { style } }).style).toBe(style);
    }
    expect(blockyConfig({ reveal_config: { style: 'sparkles' as never } }).style).toBe('pixel');
  });
});

describe('shuffled answers with several right ones', () => {
  it('keeps every right answer right after shuffling', () => {
    const q = mc({ options: ['2', '3', '4', '5'], correct_index: 0, correct_indices: [0, 2] });
    for (let g = 0; g < 20; g++) {
      const shown = shuffleOptions(q, `game-${g}:q1`);
      expect(shown.correct_indices!.map((i) => shown.options[i]).sort()).toEqual(['2', '4']);
      expect(shown.correct_indices!.map((i) => originalOption(shown, i)).sort()).toEqual([0, 2]);
    }
  });
});
