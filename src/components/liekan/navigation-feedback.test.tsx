import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NavigationFeedback } from './NavigationFeedback';
const status = vi.hoisted(() => ({ pending: false }));
vi.mock('next/link', () => ({ useLinkStatus: () => status }));
afterEach(() => vi.useRealTimers());
it('delays short navigation feedback and removes it on completion or cancellation', () => {
  vi.useFakeTimers();
  const view = render(<NavigationFeedback />);
  status.pending = true;
  view.rerender(<NavigationFeedback />);
  act(() => vi.advanceTimersByTime(199));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole('status')).toHaveTextContent('正在打开页面');
  status.pending = false;
  view.rerender(<NavigationFeedback />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
