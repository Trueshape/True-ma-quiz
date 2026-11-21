// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from './helpers/render';
import { HelpTip } from '@/components/help-tip';
import { RangeInput } from '@/components/ui/range-input';

afterEach(cleanup);

describe('HelpTip', () => {
  it('shows the explanation on hover and hides it after', async () => {
    const user = userEvent.setup();
    render(<p>Points <HelpTip>Points for a right answer.</HelpTip></p>);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(screen.getByRole('button', { name: 'More information' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Points for a right answer.');
    await user.unhover(screen.getByRole('button', { name: 'More information' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a tap keeps it open; Escape or a tap elsewhere closes it', async () => {
    const user = userEvent.setup();
    render(<div><HelpTip>Info</HelpTip><button>elsewhere</button></div>);
    await user.click(screen.getByRole('button', { name: 'More information' }));
    await user.unhover(screen.getByRole('button', { name: 'More information' }));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.unhover(screen.getByRole('button', { name: 'More information' }));
    await user.tab();
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('RangeInput', () => {
  it('fills the bar up to the handle', () => {
    render(<RangeInput aria-label="r" min={10} max={110} value={35} onChange={() => {}} />);
    expect((screen.getByLabelText('r') as HTMLInputElement).style.getPropertyValue('--fill')).toBe('25%');
  });
});
