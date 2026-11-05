// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindInput, onMac, type InputHandlers } from '../../src/input';

/** jsdom has no PointerEvent: a MouseEvent carries the button and position, pointerType is added on top. */
function pointer(type: string, init: { button?: number; buttons?: number; pointerType?: string; x?: number; y?: number; ctrlKey?: boolean } = {}): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, clientX: init.x ?? 0, clientY: init.y ?? 0, ctrlKey: init.ctrlKey ?? false, buttons: init.buttons ?? 0 });
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

  it('on a Mac, Ctrl+click is a right click: counter-clockwise', () => {
    unbind();
    unbind = bindInput(stage, h as unknown as InputHandlers, true);
    stage.dispatchEvent(pointer('pointerdown', { button: 0, ctrlKey: true, x: 10, y: 20 }));
    stage.dispatchEvent(pointer('pointerdown', { button: 0, x: 11, y: 21 }));
    expect(h.tap.mock.calls).toEqual([[10, 20, -1], [11, 21, 1]]);
  });

  it('elsewhere Ctrl+click stays a left click', () => {
    unbind();
    unbind = bindInput(stage, h as unknown as InputHandlers, false);
    stage.dispatchEvent(pointer('pointerdown', { button: 0, ctrlKey: true, x: 10, y: 20 }));
    expect(h.tap.mock.calls).toEqual([[10, 20, 1]]);
  });

  it('a right press while the left is held (a pointermove with button 2) turns back', () => {
    stage.dispatchEvent(pointer('pointerdown', { button: 0, x: 10, y: 20 }));
    stage.dispatchEvent(pointer('pointermove', { button: 2, buttons: 3, x: 12, y: 22 }));
    expect(h.tap.mock.calls).toEqual([[10, 20, 1], [12, 22, -1]]);
    expect(h.hover).toHaveBeenCalledWith(12, 22);
  });

  it('releasing the right button while the left is held does not turn back a second time', () => {
    stage.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, x: 10, y: 20 }));
    stage.dispatchEvent(pointer('pointermove', { button: 2, buttons: 3, x: 12, y: 22 })); // the right press
    stage.dispatchEvent(pointer('pointermove', { button: 2, buttons: 1, x: 12, y: 22 })); // the right release
    stage.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, x: 12, y: 22 }));
    expect(h.tap.mock.calls.filter((c) => c[2] === -1)).toEqual([[12, 22, -1]]);
    expect(h.tap).toHaveBeenCalledTimes(2);
  });

  it('a plain mouse move (button -1) only hovers, and a touch move never turns', () => {
    stage.dispatchEvent(pointer('pointermove', { button: -1, x: 3, y: 4 }));
    stage.dispatchEvent(pointer('pointermove', { pointerType: 'touch', button: 2, x: 3, y: 4 }));
    expect(h.tap).not.toHaveBeenCalled();
    expect(h.hover).toHaveBeenCalledTimes(1);
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

describe('onMac', () => {
  const platform = (value: string) => vi.spyOn(navigator, 'platform', 'get').mockReturnValue(value);
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });
  });

  it('reads navigator.platform', () => {
    platform('MacIntel');
    expect(onMac()).toBe(true);
    platform('Win32');
    expect(onMac()).toBe(false);
  });

  it('prefers userAgentData.platform where there is one', () => {
    platform('Win32');
    Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'macOS' }, configurable: true });
    expect(onMac()).toBe(true);
  });
});
