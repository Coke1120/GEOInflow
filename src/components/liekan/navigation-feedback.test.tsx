import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NavigationFeedback } from './NavigationFeedback';

const status = vi.hoisted(() => ({ pending: false }));
vi.mock('next/link', () => ({ useLinkStatus: () => status }));
it('announces the framework navigation state until completion or cancellation', () => {
  const view = render(<NavigationFeedback />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  status.pending = true;
  view.rerender(<NavigationFeedback />);
  expect(screen.getByRole('status')).toHaveTextContent('正在打开页面');
  status.pending = false;
  view.rerender(<NavigationFeedback />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
