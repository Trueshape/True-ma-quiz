// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from './helpers/render';

const quizzes = vi.hoisted(() => [
  { id: 'q1', title: "Capitali d'Europa", description: 'Dove si trova cosa', cover_image_url: null, created_by: 'ann', created_at: '2026-01-04', is_public: true, tags: ['geografia', 'europa'] },
  { id: 'q2', title: 'Fiumi del mondo', description: null, cover_image_url: null, created_by: 'bob', created_at: '2026-01-03', is_public: true, tags: ['geografia'] },
  { id: 'q3', title: 'Imperatori', description: 'Da Augusto a Costantino', cover_image_url: null, created_by: 'ann', created_at: '2026-01-02', is_public: true, tags: ['storia', 'roma'] },
  { id: 'q4', title: 'Matematica base', description: null, cover_image_url: null, created_by: 'cy', created_at: '2026-01-01', is_public: true, tags: [] },
]);

vi.mock('@/lib/supabase', () => ({
  getGuestSession: () => null,
  supabase: {
    from: (table: string) =>
      table === 'quizzes'
        ? { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: quizzes, error: null }) }) }) }) }
        : { select: () => ({ eq: () => Promise.resolve({ count: 3 }) }) },
  },
}));
vi.mock('@/lib/game-api', () => ({ createSession: vi.fn() }));
vi.mock('@/components/header-controls', () => ({ HeaderEnd: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import LibraryPage from '@/app/library/page';

afterEach(cleanup);

const cardTitles = () => ['Capitali d\'Europa', 'Fiumi del mondo', 'Imperatori', 'Matematica base'].filter((t) => screen.queryByText(t));

async function open() {
  render(<LibraryPage />);
  await screen.findByText("Capitali d'Europa");
  return { user: userEvent.setup(), box: screen.getByRole('combobox') as HTMLInputElement };
}

describe('library tags', () => {
  it('shows every public quiz with its tags', async () => {
    await open();
    expect(cardTitles()).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /^#/ }).map((b) => b.textContent)).toEqual([
      '#geografia', '#europa', '#geografia', '#storia', '#roma',
    ]);
  });

  it('suggests tags while typing, with how many quizzes use them, most used first', async () => {
    const { user, box } = await open();
    await user.type(box, 'g');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['#geografia2']);
    await user.clear(box);
    await user.type(box, 'o');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['#geografia2', '#europa1', '#roma1', '#storia1']);
  });

  it('picking a suggestion filters the quizzes and shows the tag in the search box', async () => {
    const { user, box } = await open();
    await user.type(box, 'geo');
    await user.click(screen.getByRole('option', { name: /geografia/ }));
    expect(cardTitles()).toEqual(["Capitali d'Europa", 'Fiumi del mondo']);
    expect(screen.getByRole('button', { name: 'Remove tag geografia' })).toBeTruthy();
    expect(box.value).toBe('');
  });

  it('a tag on a card works as a filter and clicking it again removes it', async () => {
    const { user } = await open();
    await user.click(screen.getAllByRole('button', { name: '#storia' })[0]);
    expect(cardTitles()).toEqual(['Imperatori']);
    await user.click(screen.getAllByRole('button', { name: '#storia' })[0]);
    expect(cardTitles()).toHaveLength(4);
  });

  it('several tags narrow the list down together', async () => {
    const { user } = await open();
    await user.click(screen.getAllByRole('button', { name: '#geografia' })[0]);
    await user.click(screen.getByRole('button', { name: '#europa' }));
    expect(cardTitles()).toEqual(["Capitali d'Europa"]);
  });

  it('plain text also finds quizzes by their tags', async () => {
    const { user, box } = await open();
    await user.type(box, 'roma');
    expect(cardTitles()).toEqual(['Imperatori']);
    await user.clear(box);
    await user.type(box, '#STOR');
    expect(cardTitles()).toEqual(['Imperatori']);
  });

  it('title, description and author are still searched', async () => {
    const { user, box } = await open();
    await user.type(box, 'augusto');
    expect(cardTitles()).toEqual(['Imperatori']);
    await user.clear(box);
    await user.type(box, 'bob');
    expect(cardTitles()).toEqual(['Fiumi del mondo']);
  });

  it('says so when nothing matches, and removing the tag brings the quizzes back', async () => {
    const { user, box } = await open();
    await user.click(screen.getAllByRole('button', { name: '#storia' })[0]);
    await user.type(box, 'xyz');
    expect(cardTitles()).toEqual([]);
    expect(screen.getByText('No results found')).toBeTruthy();
    await user.clear(box);
    await user.click(screen.getByRole('button', { name: 'Remove tag storia' }));
    expect(cardTitles()).toHaveLength(4);
  });
});
