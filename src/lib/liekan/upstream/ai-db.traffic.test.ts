import { expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: { client: {} }, getRawQueryClient: () => ({}) }));
import { aiExecutor } from './ai-db';

it('applies the shared policy to crawler referral reads while preserving mutation semantics', async () => {
  const raw = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  };
  const tx = aiExecutor(raw);
  await tx.query(
    'SELECT e.session_id FROM website_event e WHERE e.website_id=$1::uuid',
    'fixture-site',
  );
  expect(raw.$queryRawUnsafe.mock.calls[0][0]).toContain(
    'website_event AS (SELECT * FROM liekan_effective_website_event)',
  );
  expect(raw.$queryRawUnsafe.mock.calls[0][1]).toBe('fixture-site');
  await tx.query('UPDATE website SET name=$1 RETURNING *', 'name');
  expect(raw.$queryRawUnsafe.mock.calls[1][0]).toBe(
    '/* liekan_ai */ UPDATE website SET name=$1 RETURNING *',
  );
  await tx.execute('DELETE FROM website_event WHERE event_id=$1', 'fixture-event');
  expect(raw.$executeRawUnsafe.mock.calls[0][0]).toBe(
    '/* liekan_ai */ DELETE FROM website_event WHERE event_id=$1',
  );
});
