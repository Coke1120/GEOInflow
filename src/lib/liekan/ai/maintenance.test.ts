import { expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { client: {} }, getRawQueryClient: vi.fn() }));
vi.mock('../upstream/ai-db', () => ({ aiTransaction: (fn: any) => fn(mocks) }));

import { aiMaintenanceCheck, cleanupAiData } from './maintenance';

test.each(['check', 'cleanup'])(
  'serializes the read-only %s status with bigint backlog',
  async operation => {
    mocks.query
      .mockReset()
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce([
        {
          connections: 2n,
          encryptedkeys: 2n,
          messages: 0n,
          contexts: 0n,
          activeruns: 0n,
          backlog: 3n,
        },
      ])
      .mockResolvedValueOnce([
        {
          last_cleanup_at: null,
          last_error_code: null,
          backlog: 3n,
          updated_at: new Date('2026-10-04T00:00:00Z'),
          unexpected_secret: 'private-value',
        },
      ]);
    const result = operation === 'check' ? await aiMaintenanceCheck() : await cleanupAiData();
    const json = JSON.stringify(result);
    expect(JSON.parse(json)).toMatchObject({
      installed: true,
      backlog: '3',
      maintenance: { backlog: '3', updated_at: '2026-10-04T00:00:00.000Z' },
    });
    expect(json).not.toContain('private-value');
    expect(mocks.execute).not.toHaveBeenCalled();
  },
);
