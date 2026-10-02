import { describe, expect, it, vi } from 'vitest';
import { assertUpstreamSchema, requiredColumns } from '../../../scripts/liekan-schema-check.mjs';

describe('upstream storage compatibility', () => {
  const columns = () =>
    Object.entries(requiredColumns).flatMap(([table, fields]) =>
      Object.entries(fields).map(([column, type]) => ({
        table_name: table,
        column_name: column,
        data_type: type,
      })),
    );
  it('accepts the declared baseline and rejects a missing or changed upstream column', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://dummy:dummy@localhost/dummy');
    const client = { $queryRawUnsafe: vi.fn().mockResolvedValue(columns()) };
    await expect(assertUpstreamSchema(client)).resolves.toBeUndefined();
    client.$queryRawUnsafe.mockResolvedValue(
      columns().filter(row => row.column_name !== 'visit_id'),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('website_event.visit_id');
    client.$queryRawUnsafe.mockResolvedValue(
      columns().filter(row => row.table_name !== 'team_user'),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('team_user.role');
    client.$queryRawUnsafe.mockResolvedValue(
      columns().filter(row => !(row.table_name === 'website' && row.column_name === 'user_id')),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('website.user_id');
    client.$queryRawUnsafe.mockResolvedValue(
      columns().map(row =>
        row.column_name === 'visit_id' ? { ...row, data_type: 'integer' } : row,
      ),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('website_event.visit_id');
    vi.unstubAllEnvs();
  });
});
