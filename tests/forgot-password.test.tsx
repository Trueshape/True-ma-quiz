// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from './helpers/render';

const m = vi.hoisted(() => ({
  push: vi.fn(),
  router: null as unknown as { push: unknown },
  reset: vi.fn(),
  sendEmail: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => m.router }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/header-controls', () => ({ HeaderEnd: () => null, HeaderBack: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithPassword: m.signIn } } }));
vi.mock('@/lib/recovery', async () => {
  const real = await vi.importActual<typeof import('@/lib/recovery')>('@/lib/recovery');
  return { ...real, resetPasswordWithCode: m.reset, sendResetEmail: m.sendEmail };
});

import ForgotPasswordPage from '@/app/forgot-password/page';

beforeEach(() => {
  m.router = { push: m.push };
  m.push.mockReset();
  m.reset.mockReset().mockResolvedValue({ ok: true });
  m.sendEmail.mockReset().mockResolvedValue(true);
  m.signIn.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);

async function fillCode(user: ReturnType<typeof userEvent.setup>, pw = 'nuova-password', again = pw) {
  await user.type(screen.getByLabelText('Nickname'), 'AnnaRossi');
  await user.type(screen.getByLabelText('Recovery code'), 'abcd-efgh-jkmn');
  await user.type(screen.getByLabelText('New password'), pw);
  await user.type(screen.getByLabelText('New password again'), again);
  await user.click(screen.getByRole('button', { name: 'Set new password' }));
}

describe('forgot password', () => {
  it('nickname + code set the password, sign in and open the profile for a new code', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await fillCode(user);
    expect(m.reset).toHaveBeenCalledWith('AnnaRossi', 'abcd-efgh-jkmn', 'nuova-password');
    await vi.waitFor(() => expect(m.push).toHaveBeenCalledWith('/profile?code=used'));
    expect(m.signIn).toHaveBeenCalledWith({ email: 'annarossi@truemaquiz.local', password: 'nuova-password' });
  });

  it('checks the passwords before asking the server', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await fillCode(user, 'nuova-password', 'altra-password');
    expect(screen.getByRole('alert').textContent).toContain('different');
    expect(m.reset).not.toHaveBeenCalled();
  });

  it('shows the server answer for a wrong code', async () => {
    m.reset.mockResolvedValue({ ok: false, error: 'invalid_code' });
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await fillCode(user);
    expect((await screen.findByRole('alert')).textContent).toContain('do not match');
    expect(m.push).not.toHaveBeenCalled();
  });

  it('by email: sends the link and gives the same answer for any address', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await user.click(screen.getByRole('tab', { name: /email/i }));
    await user.type(screen.getByLabelText('Email'), 'anna@mail.test');
    await user.click(screen.getByRole('button', { name: 'Send me a link' }));
    expect(m.sendEmail).toHaveBeenCalledWith('anna@mail.test');
    expect((await screen.findByRole('status')).textContent).toContain('If an account uses anna@mail.test');
  });
});
