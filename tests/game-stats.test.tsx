// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from './helpers/render';
import { PlayerGameSummary, PlayerQuestionStatsLine } from '@/components/game-stats';
import type { Question } from '@/lib/supabase';

afterEach(cleanup);

const questions = [
  { id: 'a', type: 'mc', prompt: 'Capitale?' },
  { id: 'b', type: 'open', prompt: 'Fiume?' },
] as unknown as Question[];

const stats = [
  { question_index: 0, question_id: 'a', players: 4, answered: 4, correct: 1, mine: true, mine_points: 900 },
  { question_index: 1, question_id: 'b', players: 4, answered: 3, correct: 2, mine: false, mine_points: 0 },
];

describe('player statistics', () => {
  it('says how many questions the player got right, with the room share for each', () => {
    render(<PlayerGameSummary stats={stats} questions={questions} />);
    expect(screen.getByText(/You got/).textContent).toContain('1');
    expect(screen.getByText('1/4', { exact: false })).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy();
  });

  it('shows the room share under a question after it ends', () => {
    render(<PlayerQuestionStatsLine stats={stats[0]} />);
    expect(screen.getByText('1').textContent).toBe('1');
    expect(screen.getByText(/answered it right/).textContent).toContain('(25%)');
  });

  it('shows nothing when nobody answered', () => {
    render(<PlayerQuestionStatsLine stats={{ ...stats[0], answered: 0, correct: 0 }} />);
    expect(screen.queryByText(/answered it right/)).toBeNull();
  });
});
