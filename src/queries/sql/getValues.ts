import { citySearchSQL, regionSearchSQL } from '@/lib/liekan/upstream/geography-query';
import clickhouse from '@/lib/clickhouse';
import { FILTER_COLUMNS, SESSION_COLUMNS } from '@/lib/constants';
import {
  getClickHouseCountrySQL,
  getClickHouseRegionSQL,
  getPostgresCountrySQL,
  getPostgresRegionSQL,
} from '@/lib/country';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';

const SESSION_DB_COLUMNS = new Set(
  SESSION_COLUMNS.map(col => FILTER_COLUMNS[col as keyof typeof FILTER_COLUMNS]).filter(Boolean),
);

const FUNCTION_NAME = 'getValues';

export async function getValues(
  ...args: [websiteId: string, column: string, filters: QueryFilters]
) {
  return runQuery({
    [PRISMA]: () => relationalQuery(...args),
    [CLICKHOUSE]: () => clickhouseQuery(...args),
  });
}

async function relationalQuery(websiteId: string, column: string, filters: QueryFilters) {
  const { rawQuery } = prisma;
  const getSearchSQL = (field: string, key = 'search') =>
    column === 'city'
      ? `and ${citySearchSQL('country', 'region', 'city', 'postgres', 'c', `{{${key}}}`)}`
      : column === 'region'
        ? `and ${regionSearchSQL('country', 'region', 'postgres', 'c', `{{${key}}}`)}`
        : prisma.getSearchSQL(field, key);
  const params = {};
  const { startDate, endDate, search } = filters;
  const valueColumn = getValueColumn(column, 'postgres');

  let searchQuery = '';
  let excludeDomain = '';

  if (column === 'referrer_domain') {
    excludeDomain = `and website_event.referrer_domain != regexp_replace(website_event.hostname, '^www.', '')
      and website_event.referrer_domain != ''`;
  }

  if (search) {
    if (decodeURIComponent(search).includes(',')) {
      searchQuery = `AND (${decodeURIComponent(search)
        .split(',')
        .slice(0, 5)
        .map((value: string, index: number) => {
          const key = `search${index}`;

          params[key] = value;

          return getSearchSQL(valueColumn, key).replace('and ', '');
        })
        .join(' OR ')})`;
    } else {
      searchQuery = getSearchSQL(valueColumn);
    }
  }

  if (SESSION_DB_COLUMNS.has(column)) {
    return rawQuery(
      `
      select ${valueColumn} as "value", ${column === 'city' ? 'country,region,' : ''} count(*) as "count"
      from session
      where website_id = {{websiteId::uuid}}
        and created_at between {{startDate}} and {{endDate}}
        ${searchQuery}
      group by 1${column === 'city' ? ',2,3' : ''}
      order by "count" desc, "value"
      limit 10
      `,
      { websiteId, startDate, endDate, search: `%${search}%`, ...params },
      FUNCTION_NAME,
    );
  }

  return rawQuery(
    `
    select ${valueColumn} as "value", ${column === 'city' ? 'country,region,' : ''} count(*) as "count"
    from website_event
    where website_event.website_id = {{websiteId::uuid}}
      and website_event.created_at between {{startDate}} and {{endDate}}
      ${searchQuery}
      ${excludeDomain}
    group by 1${column === 'city' ? ',2,3' : ''}
    order by "count" desc, "value"
    limit 10
    `,
    { websiteId, startDate, endDate, search: `%${search}%`, ...params },
    FUNCTION_NAME,
  );
}

async function clickhouseQuery(websiteId: string, column: string, filters: QueryFilters) {
  const { rawQuery } = clickhouse;
  const getSearchSQL = (field: string, key = 'search') =>
    column === 'city'
      ? `and ${citySearchSQL('country', 'region', 'city', 'clickhouse', 'c', `{${key}:String}`)}`
      : column === 'region'
        ? `and ${regionSearchSQL('country', 'region', 'clickhouse', 'c', `{${key}:String}`)}`
        : clickhouse.getSearchSQL(field, key);
  const params = {};
  const { startDate, endDate, search } = filters;
  const valueColumn = getValueColumn(column, 'clickhouse');

  let searchQuery = '';
  let excludeDomain = '';

  if (column === 'referrer_domain') {
    excludeDomain = `and referrer_domain != hostname and referrer_domain != ''`;
  }

  if (search) {
    if (decodeURIComponent(search).includes(',')) {
      searchQuery = `AND (${decodeURIComponent(search)
        .split(',')
        .slice(0, 5)
        .map((value: string, index: number) => {
          const key = `search${index}`;

          params[key] = value;

          return getSearchSQL(valueColumn, key).replace('and ', '');
        })
        .join(' OR ')})`;
    } else {
      searchQuery = getSearchSQL(valueColumn);
    }
  }

  return rawQuery(
    `
    select ${valueColumn} as "value", ${column === 'city' ? 'country,region,' : ''} count(*) as "count"
    from website_event
    where website_id = {websiteId:UUID}
      and created_at between {startDate:DateTime64} and {endDate:DateTime64}
      ${searchQuery}
      ${excludeDomain}
    group by 1${column === 'city' ? ',2,3' : ''}
    order by "count" desc, "value"
    limit 10
    `,
    {
      websiteId,
      startDate,
      endDate,
      search,
      ...params,
    },
    FUNCTION_NAME,
  );
}

function getValueColumn(column: string, database: 'postgres' | 'clickhouse') {
  if (column === 'country') {
    return database === 'postgres'
      ? getPostgresCountrySQL(column)
      : getClickHouseCountrySQL(column);
  }

  if (column === 'region') {
    return database === 'postgres'
      ? getPostgresRegionSQL('country', column)
      : getClickHouseRegionSQL('country', column);
  }

  return column;
}
