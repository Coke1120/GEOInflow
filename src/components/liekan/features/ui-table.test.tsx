import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Table } from './ui';

vi.mock('./context', () => ({ useFeature: () => ({ query: {} }) }));

describe('resource list pagination', () => {
  it('returns to the last valid page after deletion reduces the page count', async () => {
    const onPage = vi.fn();
    render(<Table columns={['名称']} rows={[]} page={2} pages={1} onPage={onPage} />);
    await waitFor(() => expect(onPage).toHaveBeenCalledWith(1));
  });
});
