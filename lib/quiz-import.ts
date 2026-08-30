import type { QuestionType } from '@/lib/supabase';

export type ParsedQuestion = {
  type: QuestionType;
  prompt: string;
  options: string[];
  correct_index: number;
  time_limit_ms: number;
  points_value: number;
  open_answers: string[];
  slider_min: number;
  slider_max: number;
  slider_answer: number;
};

export type ParsedQuiz = {
  title: string;
  description: string;
  questions: ParsedQuestion[];
};

export type ParseResult =
  | { ok: true; quiz: ParsedQuiz }
  | { ok: false; error: string };

/**
 * Parses a quiz from a plain-text format.
 *
 * Supported format:
 *
 * # Quiz Title
 * > Optional quiz description
 *
 * Q: Question prompt text
 * T: mc                (optional type: mc, tf, info, slider, open — defaults to mc)
 * * Correct answer text  (marks the correct option with *)
 * - Wrong answer text
 * - Wrong answer text
 * Time: 30             (optional, seconds)
 * Points: 1000        (optional)
 *
 * For slider questions:
 * Q: What is the temperature?
 * T: slider
 * Min: 0
 * Max: 100
 * Answer: 42
 *
 * For open questions:
 * Q: Name a capital in Europe
 * T: open
 * A: Paris
 * A: London
 *
 * For true/false:
 * Q: The sky is blue
 * T: tf
 * * True
 * - False
 *
 * For info (no answers):
 * Q: Here is some interesting info
 * T: info
 *
 * Blank lines separate questions. Lines starting with # are the quiz title,
 * lines starting with > are the description.
 */
export function parseQuizText(input: string): ParseResult {
  const lines = input.replace(/\r\n/g, '\n').split('\n');

  let title = '';
  let description = '';
  const questions: ParsedQuestion[] = [];

  let i = 0;

  // Parse header: first # line is title, first > line is description
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '') { i++; continue; }
    if (line.startsWith('# ')) {
      title = line.slice(2).trim();
      i++;
      // Look for description right after title
      while (i < lines.length && lines[i].trim() === '') i++;
      if (i < lines.length && lines[i].trim().startsWith('> ')) {
        description = lines[i].trim().slice(2).trim();
        i++;
      }
      break;
    }
    if (line.startsWith('> ')) {
      description = line.slice(2).trim();
      i++;
      while (i < lines.length && lines[i].trim() === '') i++;
      if (i < lines.length && lines[i].trim().startsWith('# ')) {
        title = lines[i].trim().slice(2).trim();
        i++;
      }
      break;
    }
    // No header, fall through to question parsing
    break;
  }

  if (!title) {
    return { ok: false, error: 'Missing quiz title. Start the file with "# Your Quiz Title" on the first line.' };
  }

  // Parse questions
  while (i < lines.length) {
    // Skip blank lines
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;

    const line = lines[i].trim();

    // Must start with Q: or Question:
    if (!/^Q(?:uestion)?:\s*/i.test(line)) {
      return { ok: false, error: `Expected a question starting with "Q:" but found: "${line}"` };
    }

    const prompt = line.replace(/^Q(?:uestion)?:\s*/i, '').trim();
    if (!prompt) {
      return { ok: false, error: 'Question prompt cannot be empty.' };
    }

    i++;

    let type: QuestionType = 'mc';
    const options: string[] = [];
    let correct_index = 0;
    let time_limit_ms = 30000;
    let points_value = 1000;
    const open_answers: string[] = [];
    let slider_min = 0;
    let slider_max = 100;
    let slider_answer = 50;

    let hasCorrect = false;

    while (i < lines.length) {
      const raw = lines[i];
      const l = raw.trim();

      if (l === '') { i++; break; }
      if (/^Q(?:uestion)?:\s*/i.test(l)) break; // next question

      if (/^T(?:ype)?:\s*/i.test(l)) {
        const t = l.replace(/^T(?:ype)?:\s*/i, '').trim().toLowerCase();
        if (t === 'mc' || t === 'tf' || t === 'info' || t === 'slider' || t === 'open' || t === 'reorder') {
          type = t;
        } else {
          return { ok: false, error: `Unknown question type "${t}". Use: mc, tf, info, slider, open, or reorder.` };
        }
        i++;
        continue;
      }

      if (/^Time:\s*/i.test(l)) {
        const secs = parseInt(l.replace(/^Time:\s*/i, '').trim());
        if (!isNaN(secs) && secs >= 0) time_limit_ms = secs * 1000;
        i++;
        continue;
      }

      if (/^Points:\s*/i.test(l)) {
        const pts = parseInt(l.replace(/^Points:\s*/i, '').trim());
        if (!isNaN(pts) && pts >= 0) points_value = pts;
        i++;
        continue;
      }

      if (/^Min:\s*/i.test(l)) {
        const v = parseInt(l.replace(/^Min:\s*/i, '').trim());
        if (!isNaN(v)) slider_min = v;
        i++;
        continue;
      }

      if (/^Max:\s*/i.test(l)) {
        const v = parseInt(l.replace(/^Max:\s*/i, '').trim());
        if (!isNaN(v)) slider_max = v;
        i++;
        continue;
      }

      if (/^Answer:\s*/i.test(l)) {
        if (type === 'slider') {
          const v = parseInt(l.replace(/^Answer:\s*/i, '').trim());
          if (!isNaN(v)) slider_answer = v;
        } else {
          // For open questions, A: lines are accepted answers
          const ans = l.replace(/^Answer:\s*/i, '').trim();
          if (ans) open_answers.push(ans);
        }
        i++;
        continue;
      }

      if (/^A:\s*/i.test(l)) {
        const ans = l.replace(/^A:\s*/i, '').trim();
        if (ans) open_answers.push(ans);
        i++;
        continue;
      }

      // Option lines: * marks correct, - marks wrong
      if (/^[*-]\s*/.test(l)) {
        const isCorrect = l.startsWith('*');
        const text = l.replace(/^[*-]\s*/, '').trim();
        if (type === 'tf') {
          // For tf, options are auto-managed; still parse to detect correct
          if (isCorrect) {
            hasCorrect = true;
            correct_index = text.toLowerCase() === 'false' ? 1 : 0;
          }
        } else {
          options.push(text);
          if (isCorrect) {
            if (hasCorrect) {
              return { ok: false, error: `Question "${prompt}" has more than one correct answer marked with "*".` };
            }
            correct_index = options.length - 1;
            hasCorrect = true;
          }
        }
        i++;
        continue;
      }

      return { ok: false, error: `Unrecognized line in question "${prompt}": "${l}"` };
    }

    // Validate and finalize question
    if (type === 'tf') {
      // True/False: auto-fill options
      // correct_index already set if user marked one, default to 0 (True)
    } else if (type === 'info') {
      // Info: no options needed
      time_limit_ms = 0;
    } else if (type === 'slider') {
      if (slider_min >= slider_max) {
        return { ok: false, error: `Slider question "${prompt}": min must be less than max.` };
      }
      if (slider_answer < slider_min || slider_answer > slider_max) {
        return { ok: false, error: `Slider question "${prompt}": answer must be between min and max.` };
      }
    } else if (type === 'open') {
      if (open_answers.length === 0) {
        return { ok: false, error: `Open question "${prompt}" needs at least one accepted answer (use "A:" or "Answer:" lines).` };
      }
    } else if (type === 'mc') {
      if (options.length < 2) {
        return { ok: false, error: `Multiple-choice question "${prompt}" needs at least 2 options.` };
      }
      if (!hasCorrect) {
        return { ok: false, error: `Multiple-choice question "${prompt}" needs a correct answer marked with "*".` };
      }
    }

    questions.push({
      type,
      prompt,
      options: type === 'tf' ? ['True', 'False'] : options,
      correct_index: type === 'tf' ? correct_index : type === 'mc' ? correct_index : 0,
      time_limit_ms,
      points_value,
      open_answers: type === 'open' ? open_answers : [],
      slider_min,
      slider_max,
      slider_answer,
    });
  }

  if (questions.length === 0) {
    return { ok: false, error: 'No questions found. Add at least one question starting with "Q:".' };
  }

  return { ok: true, quiz: { title, description, questions } };
}

export const IMPORT_FORMAT_EXAMPLE = `# World Capitals
> Test your knowledge of capital cities

Q: What is the capital of France?
T: mc
* Paris
- London
- Berlin
- Madrid
Time: 20
Points: 1000

Q: The capital of Japan is Tokyo
T: tf
* True
- False

Q: Guess the population of Monaco (in thousands)
T: slider
Min: 0
Max: 100
Answer: 38

Q: Name a Scandinavian capital
T: open
A: Stockholm
A: Oslo
A: Copenhagen
A: Helsinki

Q: Did you know? Canberra was chosen as Australia's capital as a compromise between Sydney and Melbourne.
T: info`;
