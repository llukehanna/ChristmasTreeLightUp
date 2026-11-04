// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindInput, type InputHandlers } from '../../src/input';

/** jsdom has no PointerEvent: a MouseEvent carries the button and position, pointerType is added on top. */
function pointer(type: string, init: { button?: number; pointerType?: string; x?: number; y?: number } = {}): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, clientX: init.x ?? 0, clientY: init.y ?? 0 });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
}

describe('bindInput', () => {
  let stage: HTMLElement;
  let other: HTMLElement;
  let h: { [K in keyof InputHandlers]: ReturnType<typeof vi.fn> };
  let unbind: () => void;

  beforeEach(() => {
    document.body.innerHTML = '<div id="stage"></div><div id="hud"></div>';
    stage = document.getElementById('stage')!;
    other = document.getElementById('hud')!;
    h = { tap: vi.fn(), hover: vi.fn(), leave: vi.fn(), zoom: vi.fn(), pan: vi.fn() };
    unbind = bindInput(stage, h as unknown as InputHandlers);
  });
  afterEach(() => unbind());

  it('a left click turns clockwise, a right click counter-clockwise', () => {
    stage.dispatchEvent(pointer('pointerdown', { button: 0, x: 10, y: 20 }));
    stage.dispatchEvent(pointer('pointerdown', { button: 2, x: 30, y: 40 }));
    expect(h.tap.mock.calls).toEqual([[10, 20, 1], [30, 40, -1]]);
  });

  it('the middle button does nothing', () => {
    stage.dispatchEvent(pointer('pointerdown', { button: 1 }));
    expect(h.tap).not.toHaveBeenCalled();
  });

  it('a touch tap always turns clockwise', () => {
    stage.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', x: 5, y: 6 }));
    stage.dispatchEvent(pointer('pointerup', { pointerType: 'touch', x: 5, y: 6 }));
    expect(h.tap.mock.calls).toEqual([[5, 6, 1]]);
  });

  it('a pen tap always turns clockwise, whatever button the barrel reports', () => {
    stage.dispatchEvent(pointer('pointerdown', { pointerType: 'pen', button: 2, x: 7, y: 8 }));
    stage.dispatchEvent(pointer('pointerup', { pointerType: 'pen', button: 2, x: 7, y: 8 }));
    expect(h.tap.mock.calls).toEqual([[7, 8, 1]]);
  });

  it('the browser context menu never opens on the stage', () => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    stage.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('but it still opens elsewhere (HUD, text)', () => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    other.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('unbinding restores the context menu on the stage', () => {
    unbind();
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    stage.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
