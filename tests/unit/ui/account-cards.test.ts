// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { canSaveName, confirmMatches, deleteView, nameMessage, nameView, paintName, signInView } from '../../../src/ui/account-cards';

describe('the name card', () => {
  it('says what the check found, escaped', () => {
    expect(nameMessage({ status: 'available', value: ' Comet ' })).toContain('“Comet” is available');
    expect(nameMessage({ status: 'taken', value: 'Comet' })).toContain('“Comet” is taken. Try another.');
    expect(nameMessage({ status: 'reserved', value: 'Santa' })).toContain('That name is reserved');
    expect(nameMessage({ status: 'invalid', value: 'ab' })).toContain('At least 3 characters');
    expect(nameMessage({ status: 'invalid', value: 'ab!' })).toContain('Letters, numbers, spaces, - and _ only');
    expect(nameMessage({ status: 'available', value: '<b>' })).not.toContain('<b>');
  });

  it('allows Save for an available name, or when the check or the save could not run', () => {
    for (const s of ['available', 'error', 'failed'] as const) expect(canSaveName(s), s).toBe(true);
    for (const s of ['empty', 'checking', 'saving', 'taken', 'reserved', 'invalid'] as const) expect(canSaveName(s), s).toBe(false);
  });

  it('reports typing and Enter, and paints a state without re-rendering the field', () => {
    const inner = document.createElement('div');
    const input = vi.fn();
    const save = vi.fn();
    nameView({ input, save }).render(inner);
    const field = inner.querySelector('input');
    if (!field) throw new Error('no field');
    field.value = 'Comet';
    field.dispatchEvent(new Event('input'));
    expect(input).toHaveBeenCalledWith('Comet');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(save).toHaveBeenCalledTimes(1);
    paintName(inner, { status: 'available', value: 'Comet' });
    expect(inner.querySelector('.acct-check')?.getAttribute('data-state')).toBe('available');
    expect(inner.querySelector<HTMLButtonElement>('[data-act="save-name"]')?.disabled).toBe(false);
    expect(inner.querySelector('.acct-count')?.textContent).toBe('5/20');
    expect(inner.querySelector('input')).toBe(field);
  });
});

describe('the sign-in card', () => {
  it('links to Google with the return path, says the name is the one you pick, links the privacy page, and runs beforeLeave', () => {
    const inner = document.createElement('div');
    const beforeLeave = vi.fn();
    signInView({ pendingMs: 81_000, beforeLeave, returnPath: '/?test' }, false).render(inner);
    const google = inner.querySelector<HTMLAnchorElement>('a.acct-google');
    expect(google?.getAttribute('href')).toBe('/api/auth/google?return=%2F%3Ftest');
    expect(google?.textContent).toBe('Continue with Google');
    expect(inner.textContent).toContain('Your name on the leaderboard is the one you pick. We never show your email.');
    expect(inner.textContent).toContain('Your 1:21.0 is waiting on this device.');
    expect(inner.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(inner.querySelector('[data-act="peek"]')).toBeNull();
    google?.addEventListener('click', (e) => e.preventDefault()); // jsdom can't navigate
    google?.click();
    expect(beforeLeave).toHaveBeenCalledTimes(1);
  });
});

describe('the delete card', () => {
  it('enables Delete once the name is typed (any case); an account without a name types its email', () => {
    const inner = document.createElement('div');
    deleteView({ name: 'Comet', isAdmin: false, starHead: false }).render(inner);
    const input = inner.querySelector<HTMLInputElement>('#acct-confirm');
    const go = inner.querySelector<HTMLButtonElement>('[data-act="confirm-delete"]');
    expect(inner.querySelector('label')?.textContent).toBe('Type your name, Comet, to confirm');
    expect(go?.disabled).toBe(true);
    if (!input) throw new Error('no input');
    input.value = ' comet ';
    input.dispatchEvent(new Event('input'));
    expect(go?.disabled).toBe(false);
    expect(confirmMatches({ name: null, isAdmin: false, starHead: false }, 'ana@example.com')).toBe(true);
    expect(confirmMatches({ name: null, isAdmin: false, starHead: false }, 'ana')).toBe(false);
  });
});
