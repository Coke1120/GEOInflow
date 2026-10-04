import { expect, it, vi } from 'vitest';
import { observeActiveTab } from './tabVisibility';
it('keeps selection visible after rotation without moving focus or page scroll', () => {
  const strip = document.createElement('div');
  const selected = document.createElement('button');
  selected.setAttribute('aria-selected', 'true');
  strip.append(selected);
  document.body.append(strip);
  let width = 768;
  let resize!: () => void;
  const disconnect = vi.fn();
  Object.defineProperty(strip, 'clientWidth', { get: () => width });
  strip.getBoundingClientRect = () => ({ left: 0, right: width }) as DOMRect;
  selected.getBoundingClientRect = () =>
    ({ left: 600 - strip.scrollLeft, right: 740 - strip.scrollLeft }) as DOMRect;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(fn: () => void) {
        resize = fn;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  selected.focus();
  const stop = observeActiveTab(strip);
  expect(strip.scrollLeft).toBe(0);
  width = 375;
  resize();
  expect(strip.scrollLeft).toBe(365);
  expect(document.activeElement).toBe(selected);
  expect(window.scrollTo).not.toHaveBeenCalled();
  stop!();
  expect(disconnect).toHaveBeenCalledOnce();
  strip.remove();
  vi.unstubAllGlobals();
});
