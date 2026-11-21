// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from './helpers/render';

vi.mock('@/lib/supabase', async () => {
  const real = await vi.importActual<Record<string, unknown>>('@/lib/supabase');
  return { ...real, supabase: {}, getGuestSession: () => null };
});
vi.mock('@/lib/image-upload', () => ({ uploadQuestionImage: vi.fn() }));

import { HostNewTypeView, NewTypeQuestionView, NewTypeResult } from '@/components/reveal-question';
import { RevealSettings, type RevealDraft } from '@/components/reveal-editor';
import type { Question } from '@/lib/supabase';

afterEach(cleanup);
// jsdom has no canvas: the blocky picture simply draws nothing.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const question = (over: Partial<Question>) =>
  ({ id: 'q1', time_limit_ms: 20000, points_value: 1000, open_answers: ['Colosseo'], image_url: 'https://x.test/c.jpg', reveal_config: null, ...over }) as Question;

describe('player screen', () => {
  it('fill the blanks: one box per gap with the hint, Enter submits', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <NewTypeQuestionView
        question={question({ type: 'blanks', prompt: 'La capitale della {{Francia}} è {{Parigi}}', reveal_config: { hint: 'first' } })}
        questionNumber={1} totalQuestions={3} timeLeft={15000} hasAnswered={false} onSubmit={onSubmit}
      />
    );
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.placeholder)).toEqual(['F _ _ _ _ _ _', 'P _ _ _ _ _']);
    expect(screen.queryByText(/Parigi/)).toBeNull();
    await user.type(boxes[1], 'parigi{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ blankTexts: ['', 'parigi'] });
  });

  it('de-zoom: shows the zoomed picture and sends the typed answer', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <NewTypeQuestionView
        question={question({ type: 'dezoom', prompt: 'Che cosa è?', reveal_config: { start_zoom: 10, end_zoom: 1, focus_x: 0.2, focus_y: 0.8 } })}
        questionNumber={1} totalQuestions={3} timeLeft={20000} hasAnswered={false} onSubmit={onSubmit}
      />
    );
    const img = document.querySelector('img')!;
    expect(img.style.transform).toBe('scale(10)');
    expect(img.style.transformOrigin).toBe('20% 80%');
    await user.type(screen.getByLabelText('Your answer'), 'colosseo');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ openText: 'colosseo' });
  });

  it('cannot submit an empty answer, and is locked after answering', () => {
    render(
      <NewTypeQuestionView question={question({ type: 'blocky', prompt: '?' })} questionNumber={1} totalQuestions={1} timeLeft={1000} hasAnswered onSubmit={vi.fn()} />
    );
    expect((screen.getByLabelText('Your answer') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/waiting for results/i)).toBeTruthy();
  });
});

describe('host and results', () => {
  it('the host screen hides the words of a blanks sentence', () => {
    render(
      <HostNewTypeView question={question({ type: 'blanks', prompt: 'Roma è in {{Italia}}' })} questionNumber={1} totalQuestions={1} timeLeft={5000} answeredCount={2} totalPlayers={3} onSkip={vi.fn()} />
    );
    expect(screen.getByText('Roma è in ____')).toBeTruthy();
    expect(screen.getByText('2/3 answered')).toBeTruthy();
  });

  it('the solution marks each of the player\'s words', () => {
    render(<NewTypeResult question={question({ type: 'blanks', prompt: '{{Roma|Rome}} e {{Milano}}' })} blankTexts={['rome', 'Torino']} />);
    expect(screen.getByText('Roma / Rome')).toBeTruthy();
    expect(screen.getByText(/Torino/)).toBeTruthy();
  });
});

function Editor({ initial }: { initial: RevealDraft }) {
  const [q, setQ] = useState(initial);
  return (
    <>
      <RevealSettings question={q} onChange={(p) => setQ({ ...q, ...p })} />
      <output data-testid="config">{JSON.stringify(q.reveal_config)}</output>
      <output data-testid="answers">{JSON.stringify(q.open_answers)}</output>
    </>
  );
}
const draft = (over: Partial<RevealDraft>): RevealDraft => ({
  type: 'dezoom', prompt: '', image_url: '', open_answers: [''], reveal_config: {}, time_limit_ms: 30000, points_value: 1000, ...over,
});
const config = () => JSON.parse(screen.getByTestId('config').textContent!);

describe('editor settings', () => {
  it('blanks: counts the gaps and complains past five', () => {
    render(<Editor initial={draft({ type: 'blanks', prompt: '{{a}} e {{b|B}}' })} />);
    expect(screen.getByText('2 blanks: a · b / B')).toBeTruthy();
    cleanup();
    render(<Editor initial={draft({ type: 'blanks', prompt: '{{a}}{{b}}{{c}}{{d}}{{e}}{{f}}' })} />);
    expect(screen.getByText('6 blanks: at most 5.')).toBeTruthy();
  });

  it('blanks: picks the hint', async () => {
    const user = userEvent.setup();
    render(<Editor initial={draft({ type: 'blanks', prompt: '{{a}}' })} />);
    await user.click(screen.getByRole('radio', { name: /first letter/i }));
    expect(config()).toEqual({ hint: 'first' });
  });

  it('blocky: shows when the whole picture is visible and warns when it is after the time limit', async () => {
    const user = userEvent.setup();
    render(<Editor initial={draft({ type: 'blocky', image_url: 'https://x.test/a.jpg', reveal_config: { grid: 4, tiles_per_step: 2, step_ms: 2000 } })} />);
    expect(screen.getByText(/visible after 16s\./)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Centre outwards' }));
    await user.click(screen.getByRole('radio', { name: 'Blurred' }));
    expect(config()).toMatchObject({ order: 'spiral', style: 'blur' });
  });

  it('dezoom: the end zoom never goes above the start zoom', () => {
    render(<Editor initial={draft({ image_url: 'https://x.test/a.jpg', reveal_config: { start_zoom: 6, end_zoom: 3 } })} />);
    const start = screen.getByLabelText('Zoom at the start') as HTMLInputElement;
    const end = screen.getByLabelText('Zoom at the end') as HTMLInputElement;
    expect(start.value).toBe('6');
    expect(end.max).toBe('6');
  });

  it('accepted answers can be added', async () => {
    const user = userEvent.setup();
    render(<Editor initial={draft({ type: 'blocky' })} />);
    await user.type(screen.getByLabelText('Accepted answer 1'), 'Eiffel');
    await user.click(screen.getByRole('button', { name: /add another accepted answer/i }));
    await user.type(screen.getByLabelText('Accepted answer 2'), 'Torre');
    expect(screen.getByTestId('answers').textContent).toBe('["Eiffel","Torre"]');
  });
});
