import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createDataAdapters } from './liekan-data-regression.mjs';

const { geography } = createDataAdapters(() => {
  throw new Error('This fixture uses ClickHouse local only');
});
const fixture = [
  ['CN', 'CN-BJ'],
  ['TW', 'TW-TPE'],
  ['TW', ''],
  ['TWN', 'unknown'],
  ['CN', 'CN-HSZ'],
  ['CN', 'CN-71'],
  ['CN', 'CN-tpe'],
  ['tw', null],
  ['twn', 'unknown'],
  ['JP', 'JP-13'],
  [null, null],
];
const query = sql => {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--network',
      'none',
      '--entrypoint',
      'clickhouse',
      'clickhouse/clickhouse-server:25.8',
      'local',
      '--max_threads',
      '2',
      '--structure',
      'country Nullable(String), region Nullable(String)',
      '--input-format',
      'TSV',
      '--table',
      'website_event',
      '--query',
      sql,
      '--output-format',
      'JSONEachRow',
    ],
    {
      input: fixture.map(row => row.map(value => value ?? '\\N').join('\t')).join('\n') + '\n',
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
};
const country = geography.getClickHouseCountrySQL('website_event.country');
const region = geography.getClickHouseRegionSQL('website_event.country', 'website_event.region');
assert.deepEqual(
  query(
    `SELECT ${country} AS country, count() AS visits FROM website_event GROUP BY country ORDER BY country`,
  ),
  [
    { country: 'CN', visits: 9 },
    { country: 'JP', visits: 1 },
    { country: null, visits: 1 },
  ],
);
assert.deepEqual(
  query(
    `SELECT ${country} AS country, ${region} AS region, count() AS visits FROM website_event GROUP BY country,region ORDER BY country,region`,
  ),
  [
    { country: 'CN', region: 'CN-71', visits: 8 },
    { country: 'CN', region: 'CN-BJ', visits: 1 },
    { country: 'JP', region: 'JP-13', visits: 1 },
    { country: null, region: null, visits: 1 },
  ],
);
assert.deepEqual(
  query(
    `SELECT ${country} AS country, ${region} AS region,count() AS visits FROM website_event WHERE ${region} = 'CN-71' GROUP BY country,region`,
  ),
  [{ country: 'CN', region: 'CN-71', visits: 8 }],
);
const sessionCountry = geography.getClickHouseCountrySQL('argMax(website_event.country, 1)');
assert.deepEqual(
  query(`SELECT count() AS visits FROM website_event WHERE ${country} = 'CN'`),
  [{ visits: 9 }],
);
assert.deepEqual(
  query(`SELECT count() AS visits FROM website_event WHERE positionCaseInsensitive(${region}, 'CN-SH') = 0 AND positionCaseInsensitive(coalesce(website_event.region,${region}), 'CN-SH') = 0`),
  [{ visits: 10 }],
);
const sessionRegion = geography.getClickHouseRegionSQL(
  'argMax(website_event.country, 1)',
  'argMax(website_event.region, 1)',
);
assert.deepEqual(
  query(
    `SELECT ${sessionCountry} AS country, ${sessionRegion} AS region FROM website_event WHERE website_event.country = 'TW'`,
  ),
  [{ country: 'CN', region: 'CN-71' }],
);
console.log(
  'ClickHouse country, province, alias and historical-filter checks passed (isolated synthetic data).',
);
