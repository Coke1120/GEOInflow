import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Called only inside the disposable log integration database.
export async function verifyEffectiveLogView(client) {
  const schema = `effective_log_${randomUUID().replaceAll('-', '')}`;
  const sites = [randomUUID(), randomUUID(), randomUUID()];
  const sources = [randomUUID(), randomUUID(), randomUUID()];
  const importId = randomUUID();
  const legacy = (await readFile('db/liekan/migrations/007_automatic_logs.sql', 'utf8')).split(
    'CREATE VIEW liekan_effective_log AS',
  )[1];
  const migration = await readFile('db/liekan/migrations/013_effective_log_union.sql', 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}",public`);
    await client.query('CREATE TABLE liekan_log (LIKE public.liekan_log INCLUDING DEFAULTS)');
    await client.query(
      'CREATE TABLE liekan_log_interval (LIKE public.liekan_log_interval INCLUDING ALL)',
    );
    const time = seconds => new Date(Date.UTC(2026, 0, 1) + seconds * 1000);
    for (const [site, source, start, end] of [
      [0, 0, 10, 20],
      [0, 0, 15, 25],
      [0, 0, 27, 27],
      [0, 1, 30, 40],
      [0, 0, 40, null],
      [1, 2, 10, 20],
    ]) {
      await client.query(
        'INSERT INTO liekan_log_interval(id,website_id,source_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), sites[site], sources[source], time(start), end === null ? null : time(end)],
      );
    }
    // Fixed expected outcomes cover starts/ends, overlaps, zero-length intervals,
    // source switches, open intervals, other websites and sites without sources.
    const cases = [
      ['manual-before', 0, null, 9, true],
      ['manual-start', 0, null, 10, false],
      ['manual-overlap-end', 0, null, 20, false],
      ['manual-end', 0, null, 25, true],
      ['manual-zero-length', 0, null, 27, true],
      ['manual-switched', 0, null, 30, false],
      ['manual-open', 0, null, 40, false],
      ['auto-before', 0, 0, 9, false],
      ['auto-start', 0, 0, 10, true],
      ['auto-overlap-end', 0, 0, 20, true],
      ['auto-end', 0, 0, 25, false],
      ['auto-zero-length', 0, 0, 27, false],
      ['auto-wrong-source', 0, 0, 30, false],
      ['auto-open-start', 0, 0, 40, true],
      ['auto-open-later', 0, 0, 100, true],
      ['next-source-before', 0, 1, 19, false],
      ['next-source-start', 0, 1, 30, true],
      ['next-source-inside', 0, 1, 39, true],
      ['next-source-end', 0, 1, 40, false],
      ['other-site-source', 0, 2, 15, false],
      ['other-manual-before', 1, null, 9, true],
      ['other-manual-end', 1, null, 20, true],
      ['other-auto-start', 1, 2, 10, true],
      ['other-auto-end', 1, 2, 20, false],
      ['other-wrong-source', 1, 0, 15, false],
      ['unconnected-manual', 2, null, 15, true],
      ['unconnected-auto', 2, 0, 15, false],
    ];
    for (const [id, site, source, second] of cases) {
      await client.query(
        `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,
          ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification,source_id)
          VALUES($1,$2,$3,$4,'/fixture','GET',200,0,'','','','','GPTBot','OpenAI','training','unverified',$5)`,
        [id, sites[site], importId, time(second), source === null ? null : sources[source]],
      );
    }
    await client.query(`CREATE VIEW liekan_effective_log AS ${legacy}`);
    await client.query('GRANT SELECT ON liekan_effective_log TO CURRENT_USER');
    await client.query('CREATE VIEW eligibility_dependency AS SELECT id FROM liekan_effective_log');
    const metadata = async () => ({
      relation: (
        await client.query(
          "SELECT oid,relowner,relacl FROM pg_class WHERE oid='liekan_effective_log'::regclass",
        )
      ).rows,
      columns: (
        await client.query(
          "SELECT attname,atttypid,atttypmod,attnum FROM pg_attribute WHERE attrelid='liekan_effective_log'::regclass AND attnum>0 ORDER BY attnum",
        )
      ).rows,
    });
    const before = await metadata();
    await client.query('CREATE TABLE legacy_rows AS TABLE liekan_effective_log');
    const expected = cases
      .filter(row => row[4])
      .map(row => row[0])
      .sort();
    const check = async () => {
      const differences = await client.query(`
        (SELECT * FROM legacy_rows EXCEPT ALL SELECT * FROM liekan_effective_log)
        UNION ALL
        (SELECT * FROM liekan_effective_log EXCEPT ALL SELECT * FROM legacy_rows)`);
      assert.equal(differences.rowCount, 0, 'all columns and multiplicities must match');
      assert.deepEqual(
        (await client.query('SELECT id FROM eligibility_dependency ORDER BY id')).rows.map(
          row => row.id,
        ),
        expected,
      );
      assert.deepEqual(
        await metadata(),
        before,
        'OID, ownership, ACL and columns must survive replacement',
      );
    };
    await client.query(migration);
    await check();
    await client.query(migration);
    await check();
    console.log(
      `PASS: effective log view preserves ${cases.length} interval cases, row multiplicities, columns, OID, ACL and dependent reads`,
    );
  } finally {
    await client.query('ROLLBACK');
  }
}
