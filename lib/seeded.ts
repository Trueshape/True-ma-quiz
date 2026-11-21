import type { Question } from '@/lib/supabase';

/** Seeded random numbers in [0, 1): the same seed gives the same numbers on every device. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0..n-1 in an order that depends only on the seed. */
export function seededOrder(n: number, seed: string): number[] {
  const rand = seededRandom(seed);
  return Array.from({ length: n }, (_, i) => ({ i, r: rand() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.i);
}

/**
 * A multiple choice question with "shuffle answer order" on, with its options in the order
 * this seed gives (one seed per game, so the host and every player see the same order).
 * `option_order[shown]` is the original index, which is what the server expects.
 */
export function shuffleOptions(q: Question, seed: string): Question {
  if (q.type !== 'mc' || !q.shuffle_options || q.options.length < 2) return q;
  const order = seededOrder(q.options.length, seed);
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correct_index: order.indexOf(q.correct_index),
    correct_indices: q.correct_indices ? q.correct_indices.map((i) => order.indexOf(i)).sort((a, b) => a - b) : q.correct_indices,
    option_order: order,
  };
}

/** The original index of the option shown at `shown`. */
export function originalOption(q: Question, shown: number): number {
  return q.option_order ? q.option_order[shown] : shown;
}
