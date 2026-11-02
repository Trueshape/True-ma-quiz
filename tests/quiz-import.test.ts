import { describe, expect, it } from 'vitest';
import { parseQuizText } from '@/lib/quiz-import';

const questionsOf = (text: string) => {
  const result = parseQuizText(text);
  if (!result.ok) throw new Error(result.error);
  return result.quiz.questions;
};
const errorOf = (text: string) => {
  const result = parseQuizText(text);
  if (result.ok) throw new Error('expected an error');
  return result.error;
};

describe('parseQuizText', () => {
  it('parses a multiple-choice question and its correct answer', () => {
    const [q] = questionsOf(`# Capitals\nQ: Capital of Italy?\n* Rome\n- Milan\n- Turin\n`);
    expect(q).toMatchObject({ type: 'mc', correct_index: 0, time_limit_ms: 30000, points_value: 1000 });
    expect(q.options).toEqual(['Rome', 'Milan', 'Turin']);
  });

  it('parses true/false, slider and open questions', () => {
    const qs = questionsOf(
      `# Mix\nQ: Sky is blue\nT: tf\n* True\n- False\n\nQ: Temp?\nT: slider\nMin: 0\nMax: 100\nAnswer: 42\n\nQ: Capital?\nT: open\nA: Rome\nA: Roma\n`
    );
    expect(qs.map((q) => q.type)).toEqual(['tf', 'slider', 'open']);
    expect(qs[1]).toMatchObject({ slider_min: 0, slider_max: 100, slider_answer: 42 });
    expect(qs[2].open_answers).toEqual(['Rome', 'Roma']);
  });

  it('ignores a zero time limit and keeps the default', () => {
    const [q] = questionsOf(`# T\nQ: X?\n* A\n- B\nTime: 0\n`);
    expect(q.time_limit_ms).toBe(30000);
  });

  it('reads custom time and points', () => {
    const [q] = questionsOf(`# T\nQ: X?\n* A\n- B\nTime: 10\nPoints: 500\n`);
    expect(q).toMatchObject({ time_limit_ms: 10000, points_value: 500 });
  });

  it.each([
    ['a missing title', `Q: X?\n* A\n- B\n`, 'Missing quiz title'],
    ['no correct answer', `# T\nQ: X?\n- A\n- B\n`, 'needs a correct answer'],
    ['two correct answers', `# T\nQ: X?\n* A\n* B\n- C\n`, 'more than one correct'],
    ['a slider with min above max', `# T\nQ: X?\nT: slider\nMin: 10\nMax: 0\nAnswer: 5\n`, 'min must be less than max'],
    ['an open question without answers', `# T\nQ: X?\nT: open\n`, 'needs at least one accepted answer'],
    ['empty input', ``, 'Missing quiz title'],
  ])('rejects %s', (_name, text, message) => {
    expect(errorOf(text)).toContain(message);
  });
});
