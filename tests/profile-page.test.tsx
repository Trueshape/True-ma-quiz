// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/dom';
import { cleanup, render, screen } from './helpers/render';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
  welcome: false,
  profile: null as null | { user_id: string; nickname: string; avatar_url: string | null },
  available: true,
  setProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  updateUser: vi.fn(),
  cropToFile: vi.fn(),
  router: null as unknown as { push: unknown; replace: unknown },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => ({ get: (k: string) => (k === 'welcome' && mocks.welcome ? '1' : null) }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1', user_metadata: { nickname: 'Gio Google' } } } } }),
      updateUser: mocks.updateUser,
    },
  },
}));
vi.mock('@/lib/profile', async () => {
  const real = await vi.importActual<typeof import('@/lib/profile')>('@/lib/profile');
  return {
    ...real,
    getMyProfile: () => Promise.resolve(mocks.profile),
    nicknameAvailable: () => Promise.resolve(mocks.available),
    setProfile: mocks.setProfile,
    uploadAvatar: mocks.uploadAvatar,
  };
});
vi.mock('@/lib/avatar-crop', async () => {
  const real = await vi.importActual<typeof import('@/lib/avatar-crop')>('@/lib/avatar-crop');
  return { ...real, cropToFile: mocks.cropToFile };
});
vi.mock('@/components/header-controls', () => ({ HeaderEnd: () => null, HeaderBack: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

import ProfilePage from '@/app/profile/page';

beforeEach(() => {
  mocks.router = { push: mocks.push, replace: mocks.replace };
  Object.assign(mocks, { welcome: false, profile: null, available: true });
  mocks.setProfile.mockReset().mockResolvedValue({ profile: { user_id: 'u1', nickname: 'GioMusic', avatar_url: null } });
  mocks.uploadAvatar.mockReset().mockResolvedValue({ url: 'https://x.test/avatars/u1/avatar?v=1' });
  mocks.updateUser.mockReset().mockResolvedValue({});
  mocks.cropToFile.mockReset().mockImplementation(async (_src: string, _f: unknown, type: string) => new File(['x'], 'avatar', { type }));
  mocks.push.mockReset();
  mocks.replace.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const username = async () => (await screen.findByLabelText('Username')) as HTMLInputElement;
const file = (type: string, size: number) => new File([new Uint8Array(size)], 'me', { type });

describe('profile page', () => {
  it('first visit asks for a username and starts from the name in the token', async () => {
    mocks.welcome = true;
    render(<ProfilePage />);
    expect(screen.getByText('Choose your username')).toBeTruthy();
    expect((await username()).value).toBe('Gio Google');
  });

  it('saves a new username, keeps the picture and goes to the dashboard', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    const box = await username();
    await user.clear(box);
    await user.type(box, 'GioMusic');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'));
    expect(mocks.setProfile).toHaveBeenCalledWith('GioMusic', undefined);
    expect(mocks.uploadAvatar).not.toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenCalledWith({ data: { nickname: 'GioMusic' } });
  });

  it('refuses names that are too short or already taken', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    const box = await username();
    await user.clear(box);
    await user.type(box, 'abc');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('4 to 20');
    mocks.available = false;
    await user.type(box, 'd');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('already taken');
    expect(mocks.setProfile).not.toHaveBeenCalled();
  });

  it('rejects a picture that is not jpg or png, or is over 1 MB, before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    await username();
    const input = screen.getByLabelText('Choose a picture');
    await user.upload(input, file('image/gif', 100));
    expect((await screen.findByRole('alert')).textContent).toContain('JPG or PNG');
    await user.upload(input, file('image/png', 1024 * 1024 + 1));
    expect((await screen.findByRole('alert')).textContent).toContain('1 MB');
    expect(mocks.uploadAvatar).not.toHaveBeenCalled();
  });

  it('uploads a valid picture and saves its address with the profile', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    await username();
    await user.upload(screen.getByLabelText('Choose a picture'), file('image/jpeg', 2000));
    expect(screen.getByAltText('Profile picture')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /save/i }));
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'));
    expect(mocks.uploadAvatar).toHaveBeenCalledWith('u1', expect.any(File));
    expect(mocks.setProfile).toHaveBeenCalledWith('Gio Google', 'https://x.test/avatars/u1/avatar?v=1');
  });

  it('a new picture can be zoomed and the framed square is what gets uploaded', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    await username();
    await user.upload(screen.getByLabelText('Choose a picture'), file('image/png', 2000));
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: /save/i }));
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'));
    expect(mocks.cropToFile).toHaveBeenCalledWith('blob:preview', { zoom: 2, x: 0, y: 0 }, 'image/png');
    expect((mocks.uploadAvatar.mock.calls[0][1] as File).name).toBe('avatar');
  });

  it('removing the picture saves an empty address', async () => {
    mocks.profile = { user_id: 'u1', nickname: 'GioMusic', avatar_url: 'https://x.test/avatars/u1/avatar?v=0' };
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    await user.click(await screen.findByRole('button', { name: /remove/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));
    await vi.waitFor(() => expect(mocks.setProfile).toHaveBeenCalledWith('GioMusic', ''));
  });

  it('shows the server answer when the name was taken in the meantime', async () => {
    mocks.setProfile.mockResolvedValue({ error: 'nickname_taken' });
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    await username();
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('already taken');
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
