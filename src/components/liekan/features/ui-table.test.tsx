import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Table } from './ui';

vi.mock('./context', () => ({ useFeature: () => ({ query: {} }) }));

describe('resource list pagination', () => {
  it('returns to the first page after deletion reduces the page count', async () => {
    const onPage = vi.fn();
    render(<Table columns={['名称']} rows={[]} page={2} pages={1} onPage={onPage} />);
    await waitFor(() => expect(onPage).toHaveBeenCalledWith(1));
  });
  it('returns to the first page when the refreshed list becomes empty', async () => {
    const onPage = vi.fn();
    const view = render(<Table columns={['名称']} rows={[]} page={4} pages={0} onPage={onPage} />);
    await waitFor(() => expect(onPage).toHaveBeenCalledExactlyOnceWith(1));
    view.rerender(<Table columns={['名称']} rows={[]} page={1} pages={0} onPage={onPage} />);
    expect(onPage).toHaveBeenCalledTimes(1);
  });
  it('keeps the current page while the page count is unknown', () => {
    const onPage = vi.fn();
    render(<Table columns={['名称']} rows={[]} page={4} onPage={onPage} />);
    expect(onPage).not.toHaveBeenCalled();
  });
});
