// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from './helpers/render';
import { MultiChoiceAnswer, hasManyRight } from '@/components/multi-choice';
import { computeMultiPoints, isRightOption, type Question } from '@/lib/supabase';

afterEach(cleanup);

const q = { type: 'mc', options: ['2', '3', '4', '5'], correct_index: 0, correct_indices: [0, 2] } as unknown as Question;

describe('several right answers', () => {
  it('scores right picks minus wrong picks, never below zero', () => {
    expect(computeMultiPoints([0, 2], [0, 2])).toEqual({ points: 1000, isCorrect: true });
    expect(computeMultiPoints([0], [0, 2])).toEqual({ points: 500, isCorrect: false });
    expect(computeMultiPoints([0, 1], [0, 2])).toEqual({ points: 0, isCorrect: false });
    expect(computeMultiPoints([0, 2, 3], [0, 2]).points).toBe(500);
    expect(computeMultiPoints([1, 3], [0, 2]).points).toBe(0);
  });

  it('knows which options are right', () => {
    expect(hasManyRight(q)).toBe(true);
    expect([0, 1, 2, 3].map((i) => isRightOption(q, i))).toEqual([true, false, true, false]);
    expect(isRightOption({ correct_index: 1, correct_indices: null }, 1)).toBe(true);
  });

  it('players tap options on and off, then lock in', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<MultiChoiceAnswer question={q} disabled={false} onSubmit={onSubmit} />);
    const lock = screen.getByRole('button', { name: /lock in/i }) as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /4/ }));
    await user.click(screen.getByRole('button', { name: /^A2$|2$/ }));
    await user.click(screen.getByRole('button', { name: /5/ }));
    await user.click(screen.getByRole('button', { name: /5/ }));
    expect(screen.getByRole('button', { name: /lock in \(2\)/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /lock in/i }));
    expect(onSubmit).toHaveBeenCalledWith([0, 2]);
  });
});
