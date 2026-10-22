import {
  identityUsable,
  unavailableFields,
  type BrowserPopulation,
} from '@/lib/liekan/contracts/browser-population';
import { readBrowserPopulation } from '@/lib/liekan/upstream/browser-population';
import { nativeSnapshot } from '@/lib/liekan/upstream/native-snapshot';
import { nativeAggregate } from '@/lib/liekan/upstream/native-aggregate';
import clickhouse from '@/lib/clickhouse';
import { EVENT_TYPE } from '@/lib/constants';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';

export interface AttributionParameters {
  startDate: Date;
  endDate: Date;
  model: string;
  type: string;
  step: string;
}

export interface AttributionResult {
  population?: BrowserPopulation;
  referrer: { name: string; value: number | null }[];
  paidAds: { name: string; value: number | null }[];
  utm_source: { name: string; value: number | null }[];
  utm_medium: { name: string; value: number | null }[];
  utm_campaign: { name: string; value: number | null }[];
  utm_content: { name: string; value: number | null }[];
  utm_term: { name: string; value: number | null }[];
  total: { pageviews: number; visitors: number | null; visits: number | null };
}

export async function getAttribution(
  ...args: [websiteId: string, parameters: AttributionParameters, filters: QueryFilters]
): Promise<AttributionResult> {
  return runQuery({
    [PRISMA]: () =>
      nativeAggregate('native-attribution-v2', args[0], args[1], args[2], () =>
        nativeSnapshot(() => relationalQuery(...args)),
      ),
    [CLICKHOUSE]: () => clickhouseQuery(...args),
  });
}

async function relationalQuery(
  websiteId: string,
  parameters: AttributionParameters,
  filters: QueryFilters,
): Promise<AttributionResult> {
  const { model, type } = parameters;
  const { rawQuery, parseFilters } = prisma;
  const eventType = type === 'path' ? EVENT_TYPE.pageView : EVENT_TYPE.customEvent;
  const column = type === 'path' ? 'url_path' : 'event_name';
  const { filterQuery, joinSessionQuery, cohortQuery, queryParams } = parseFilters({
    ...filters,
    ...parameters,
    websiteId,
    eventType,
  });

  function getUTMQuery(utmColumn: string) {
    return `
    select
        coalesce(we.${utmColumn}, '') as "name",
        count(distinct we.session_id) as "value"
    from model m
    join website_event we
    on we.created_at = m.created_at
        and we.session_id = m.session_id
    where we.website_id = {{websiteId::uuid}}
          and we.created_at between {{startDate}} and {{endDate}}
          and we.${utmColumn} != ''
    group by 1
    order by 2 desc
    limit 20`;
  }

  const eventQuery = `WITH events AS (
        select distinct
            website_event.session_id,
            max(website_event.created_at) max_dt
        from website_event
        ${cohortQuery}
        ${joinSessionQuery}
        where website_event.website_id = {{websiteId::uuid}}
          and website_event.created_at between {{startDate}} and {{endDate}}
          and website_event.${column} = {{step}}
          ${filterQuery}
        group by 1),`;

  function getModelQuery(model: string) {
    return model === 'first-click'
      ? `\n
    model AS (select e.session_id,
        min(we.created_at) created_at
    from events e
    join website_event we
    on we.session_id = e.session_id
    where we.website_id = {{websiteId::uuid}}
          and we.created_at between {{startDate}} and {{endDate}}
    group by e.session_id)`
      : `\n
    model AS (select e.session_id,
        max(we.created_at) created_at
    from events e
    join website_event we
    on we.session_id = e.session_id
    where we.website_id = {{websiteId::uuid}}
          and we.created_at between {{startDate}} and {{endDate}}
          and we.created_at < e.max_dt
    group by e.session_id)`;
  }

  const referrerRes = await rawQuery(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    select coalesce(we.referrer_domain, '') as "name",
        count(distinct we.session_id) value
    from model m
    join website_event we
    on we.created_at = m.created_at
        and we.session_id = m.session_id
    join session s
    on s.session_id = m.session_id
    where we.website_id = {{websiteId::uuid}}
          and we.created_at between {{startDate}} and {{endDate}}
          and we.referrer_domain != regexp_replace(we.hostname, '^www.', '')
          and we.referrer_domain != ''
    group by 1
    order by 2 desc
    limit 20
    `,
    queryParams,
    'getAttribution',
  );

  const paidAdsres = await rawQuery(
    `
    ${eventQuery}
    ${getModelQuery(model)},

    results AS (
    select case
            when coalesce(gclid, '') != '' then 'Google Ads'
            when coalesce(fbclid, '') != '' then 'Facebook / Meta'
            when coalesce(msclkid, '') != '' then 'Microsoft Ads'
            when coalesce(ttclid, '') != '' then 'TikTok Ads'
            when coalesce(li_fat_id, '') != '' then 'LinkedIn Ads'
            when coalesce(twclid, '') != '' then 'Twitter Ads (X)'
            else ''
          end as "name",
        count(distinct we.session_id) as "value"
    from model m
    join website_event we
    on we.created_at = m.created_at
        and we.session_id = m.session_id
    where we.website_id = {{websiteId::uuid}}
          and we.created_at between {{startDate}} and {{endDate}}
    group by 1
    order by 2 desc
    limit 20)
    SELECT *
    FROM results
    WHERE name != ''
    `,
    queryParams,
    'getAttribution',
  );

  const sourceRes = await rawQuery(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_source')}
    `,
    queryParams,
    'getAttribution',
  );

  const mediumRes = await rawQuery(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_medium')}
    `,
    queryParams,
    'getAttribution',
  );

  const campaignRes = await rawQuery(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_campaign')}
    `,
    queryParams,
    'getAttribution',
  );

  const contentRes = await rawQuery(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_content')}
    `,
    queryParams,
    'getAttribution',
  );

  const termRes = await rawQuery(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_term')}
    `,
    queryParams,
    'getAttribution',
  );

  const totalRes = await rawQuery(
    `
    select
        count(*) as "pageviews",
        count(distinct website_event.session_id) as "visitors",
        count(distinct website_event.visit_id) as "visits"
    from website_event
    ${joinSessionQuery}
    ${cohortQuery}
    where website_event.website_id = {{websiteId::uuid}}
        and website_event.created_at between {{startDate}} and {{endDate}}
        and website_event.${column} = {{step}}
        ${filterQuery}
    `,
    queryParams,
    'getAttribution',
  ).then(result => result?.[0]);

  const population = await readBrowserPopulation(
    websiteId,
    parameters.startDate,
    parameters.endDate,
    filters.timezone,
  );
  return {
    population,
    referrer: referrerRes,
    paidAds: paidAdsres,
    utm_source: sourceRes,
    utm_medium: mediumRes,
    utm_campaign: campaignRes,
    utm_content: contentRes,
    utm_term: termRes,
    total: identityUsable(population)
      ? totalRes
      : unavailableFields(totalRes, ['visitors', 'visits']),
  };
}

async function clickhouseQuery(
  websiteId: string,
  parameters: AttributionParameters,
  filters: QueryFilters,
): Promise<AttributionResult> {
  const { model, type } = parameters;
  const { rawQuery, parseFilters } = clickhouse;
  const eventType = type === 'path' ? EVENT_TYPE.pageView : EVENT_TYPE.customEvent;
  const column = type === 'path' ? 'url_path' : 'event_name';
  const { filterQuery, cohortQuery, queryParams } = parseFilters({
    ...filters,
    ...parameters,
    websiteId,
    eventType,
  });

  function getUTMQuery(utmColumn: string) {
    return `
      select
          we.${utmColumn} name,
          uniqExact(we.session_id) value
      from model m
      join (
        select *
        from website_event
        where website_id = {websiteId:UUID}
          and created_at between {startDate:DateTime64} and {endDate:DateTime64}
      ) we
      on we.created_at = m.created_at
          and we.session_id = m.session_id
      where we.${utmColumn} != ''
      group by 1
      order by 2 desc
      limit 20
    `;
  }

  function getModelQuery(model: string) {
    if (model === 'first-click') {
      return `
        model AS (select e.session_id,
            min(we.created_at) created_at
        from events e
        join (
          select *
          from website_event
          where website_id = {websiteId:UUID}
            and created_at between {startDate:DateTime64} and {endDate:DateTime64}
        ) we
        on we.session_id = e.session_id
        group by e.session_id)
      `;
    }

    return `
      model AS (select e.session_id,
          max(we.created_at) created_at
      from events e
      join (
        select *
        from website_event
        where website_id = {websiteId:UUID}
          and created_at between {startDate:DateTime64} and {endDate:DateTime64}
      ) we
      on we.session_id = e.session_id
      where we.created_at < e.max_dt
      group by e.session_id)
      `;
  }

  const eventQuery = `WITH events AS (
        select distinct
            session_id,
            max(created_at) max_dt
        from website_event
        ${cohortQuery}
        where website_id = {websiteId:UUID}
          and created_at between {startDate:DateTime64} and {endDate:DateTime64}
          and ${column} = {step:String}
          ${filterQuery}
        group by 1),`;

  const referrerRes = await rawQuery<
    {
      name: string;
      value: number;
    }[]
  >(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    select we.referrer_domain name,
        uniqExact(we.session_id) value
    from model m
    join (
      select *
      from website_event
      where website_id = {websiteId:UUID}
        and created_at between {startDate:DateTime64} and {endDate:DateTime64}
    ) we
    on we.created_at = m.created_at
        and we.session_id = m.session_id
    where we.referrer_domain != hostname
      and we.referrer_domain != ''
    group by 1
    order by 2 desc
    limit 20
    `,
    queryParams,
    'getAttribution',
  );

  const paidAdsres = await rawQuery<
    {
      name: string;
      value: number;
    }[]
  >(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    select multiIf(gclid != '', 'Google Ads',
                   fbclid != '', 'Facebook / Meta',
                   msclkid != '', 'Microsoft Ads',
                   ttclid != '', 'TikTok Ads',
                   li_fat_id != '', 'LinkedIn Ads',
                   twclid != '', 'Twitter Ads (X)','') name,
        uniqExact(we.session_id) value
    from model m
    join (
      select *
      from website_event
      where website_id = {websiteId:UUID}
        and created_at between {startDate:DateTime64} and {endDate:DateTime64}
    ) we
    on we.created_at = m.created_at
        and we.session_id = m.session_id
    where name != ''
    group by 1
    order by 2 desc
    limit 20
    `,
    queryParams,
    'getAttribution',
  );

  const sourceRes = await rawQuery<
    {
      name: string;
      value: number;
    }[]
  >(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_source')}
    `,
    queryParams,
    'getAttribution',
  );

  const mediumRes = await rawQuery<
    {
      name: string;
      value: number;
    }[]
  >(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_medium')}
    `,
    queryParams,
    'getAttribution',
  );

  const campaignRes = await rawQuery<
    {
      name: string;
      value: number;
    }[]
  >(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_campaign')}
    `,
    queryParams,
    'getAttribution',
  );

  const contentRes = await rawQuery<
    {
      name: string;
      value: number;
    }[]
  >(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_content')}
    `,
    queryParams,
    'getAttribution',
  );

  const termRes = await rawQuery<
    {
      name: string;
      value: number;
    }[]
  >(
    `
    ${eventQuery}
    ${getModelQuery(model)}
    ${getUTMQuery('utm_term')}
    `,
    queryParams,
    'getAttribution',
  );

  const totalRes = await rawQuery<{ pageviews: number; visitors: number; visits: number }>(
    `
    select 
        count(*) as "pageviews",
        uniqExact(session_id) as "visitors",
        uniqExact(visit_id) as "visits"
    from website_event
    ${cohortQuery}
    where website_id = {websiteId:UUID}
        and created_at between {startDate:DateTime64} and {endDate:DateTime64}
        and ${column} = {step:String}
        ${filterQuery}
    `,
    queryParams,
  ).then(result => result?.[0]);

  return {
    referrer: referrerRes,
    paidAds: paidAdsres,
    utm_source: sourceRes,
    utm_medium: mediumRes,
    utm_campaign: campaignRes,
    utm_content: contentRes,
    utm_term: termRes,
    total: totalRes,
  };
}
