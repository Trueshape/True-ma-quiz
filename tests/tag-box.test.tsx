// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from './helpers/render';
import userEvent from '@testing-library/user-event';
import { TagBox } from '@/components/tag-box';
import type { TagCount } from '@/lib/tags';

afterEach(cleanup);

const known: TagCount[] = [
  { tag: 'storia', count: 5 },
  { tag: 'geografia', count: 3 },
  { tag: 'roma', count: 2 },
  { tag: 'romanzi', count: 1 },
];

function Harness({ allowNew = false, suggestWhenEmpty = false, initial = [] as string[] }) {
  const [chips, setChips] = useState(initial);
  const [text, setText] = useState('');
  return (
    <div>
      <TagBox
        chips={chips}
        onChipsChange={setChips}
        text={text}
        onTextChange={setText}
        known={known}
        allowNew={allowNew}
        suggestWhenEmpty={suggestWhenEmpty}
        maxChips={3}
        placeholder="Add a tag"
      />
      <output data-testid="chips">{chips.join(',')}</output>
    </div>
  );
}
const chipsText = () => screen.getByTestId('chips').textContent;

describe('TagBox as a search box (only listed tags can be picked)', () => {
  it('shows nothing until something is typed, then suggests matching tags with their counts', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(box, 'rom');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['#roma2', '#romanzi1']);
  });

  it('picks a suggestion with the keyboard and clears the text', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await user.type(box, 'sto');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(chipsText()).toBe('storia');
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('picks a suggestion with the mouse', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'geo');
    await user.click(screen.getByRole('option', { name: /geografia/ }));
    expect(chipsText()).toBe('geografia');
  });

  it('Enter without a highlighted suggestion adds nothing, so the text stays a plain search', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await user.type(box, 'parigi{Enter}');
    expect(chipsText()).toBe('');
    expect((box as HTMLInputElement).value).toBe('parigi');
  });

  it('already chosen tags are not suggested again', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['roma']} />);
    await user.type(screen.getByRole('combobox'), 'rom');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['#romanzi1']);
  });

  it('Backspace on empty text removes the last tag, and the x button removes a tag', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['storia', 'roma']} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Backspace}');
    expect(chipsText()).toBe('storia');
    await user.click(screen.getByRole('button', { name: 'Remove tag storia' }));
    expect(chipsText()).toBe('');
  });
});

describe('TagBox as the editor field (new tags allowed)', () => {
  it('shows the most used tags on focus', async () => {
    const user = userEvent.setup();
    render(<Harness allowNew suggestWhenEmpty />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['#storia5', '#geografia3', '#roma2', '#romanzi1']);
  });

  it('Enter and comma turn the text into a clean tag', async () => {
    const user = userEvent.setup();
    render(<Harness allowNew />);
    const box = screen.getByRole('combobox');
    await user.type(box, '  #Nuova Idea{Enter}');
    expect(chipsText()).toBe('nuova-idea');
    await user.type(box, 'altro,');
    expect(chipsText()).toBe('nuova-idea,altro');
  });

  it('does not add a duplicate and stops at the maximum', async () => {
    const user = userEvent.setup();
    render(<Harness allowNew initial={['a', 'b']} />);
    const box = screen.getByRole('combobox');
    await user.type(box, 'A{Enter}');
    expect(chipsText()).toBe('a,b');
    await user.type(box, 'c{Enter}');
    expect(chipsText()).toBe('a,b,c');
    expect((box as HTMLInputElement).disabled).toBe(true);
  });

  it('adds the pending text when the field loses focus', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness allowNew />
        <button>elsewhere</button>
      </div>
    );
    await user.type(screen.getByRole('combobox'), 'finale');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(chipsText()).toBe('finale');
  });
});

describe('TagBox with pasted or fast text', () => {
  it('a pasted list with commas becomes several tags and the last part stays as text', async () => {
    const user = userEvent.setup();
    render(<Harness allowNew />);
    const box = screen.getByRole('combobox') as HTMLInputElement;
    await user.click(box);
    await user.paste('Uno, due ,#Tre quattro,cin');
    expect(chipsText()).toBe('uno,due,tre-quattro');
    expect(box.value).toBe('cin');
  });

  it('commas past the maximum are ignored and duplicates are not added twice', async () => {
    const user = userEvent.setup();
    render(<Harness allowNew initial={['a']} />);
    await user.click(screen.getByRole('combobox'));
    await user.paste('a,b,c,d,');
    expect(chipsText()).toBe('a,b,c');
  });
});
