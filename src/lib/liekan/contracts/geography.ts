import catalog from './geography-catalog.json' with { type: 'json' };
import { normalizeCountryCode, normalizeRegionCode } from '../upstream/geography-codes';
import countries from '../../../../public/intl/country/zh-CN.json' with { type: 'json' };
import regions from '../../../../public/iso-3166-2.json' with { type: 'json' };

export const geographyDisplayRuleVersion = 'city-known-1';
export const geographyVersion = `geo-${catalog.version}-rules-3-${geographyDisplayRuleVersion}`;
export const provinceDefinitions = catalog.provinces;
export const cityDefinitions = catalog.cities;
export const geographyAlias = (value: string) => value.normalize('NFC').trim().toLowerCase();
export const requiresRegion = (country: string, alias: string) =>
  country === 'CN' &&
  ['taizhou', 'suzhou', 'yichun', 'yulin', 'fuzhou', "ji'an", 'jian'].includes(
    geographyAlias(alias).replaceAll('’', "'"),
  );
const provinceCodes = new Map(
  provinceDefinitions.flatMap(
    p =>
      [
        [p.code, p.code],
        [p.alias, p.code],
      ] as [string, string][],
  ),
);
const cityAliases = new Map<string, typeof cityDefinitions>();
for (const city of cityDefinitions) {
  for (const alias of new Set(city.aliases.map(geographyAlias))) {
    const key = JSON.stringify([city.country, alias]);
    cityAliases.set(key, [...(cityAliases.get(key) || []), city]);
  }
}

export function geographyRegion(region?: string | null, country?: string | null) {
  const prefix = region?.includes('-') ? normalizeCountryCode(region.trim().split('-')[0]) : null;
  const cc = normalizeCountryCode(country?.trim());
  if (prefix && cc && prefix !== cc) return region.trim().toUpperCase();
  const normalized = normalizeRegionCode(region?.trim().toUpperCase(), country?.trim());
  return provinceCodes.get(normalized) || normalized || null;
}

export function countryName(code?: string | null) {
  const country = normalizeCountryCode(code?.trim());
  return countries[country] || country || '未知';
}

export function regionName(code?: string | null, country?: string | null) {
  const region = geographyRegion(code, country);
  if (
    region?.includes('-') &&
    country &&
    normalizeCountryCode(region.split('-')[0]) !== normalizeCountryCode(country.trim())
  )
    return region;
  return (
    provinceDefinitions.find(p => p.code === region)?.name || regions[region] || region || '未知'
  );
}

export function regionAliases(code?: string | null, country?: string | null) {
  const region = geographyRegion(code, country);
  if (
    region?.includes('-') &&
    country &&
    normalizeCountryCode(region.split('-')[0]) !== normalizeCountryCode(country.trim())
  )
    return [code, region].filter(Boolean);
  const p = provinceDefinitions.find(p => p.code === region);
  return p
    ? [
        ...new Set(
          [p.code, p.alias, p.code.slice(3), p.alias.slice(3), p.name, regions[p.alias]].filter(
            Boolean,
          ),
        ),
      ]
    : [code, region].filter(Boolean);
}

export function cityValueOptions(
  rows: (Geography & { value: string; count: number })[],
  chinese = true,
) {
  const grouped = new Map<string, { value: string; count: number; labels: Set<string> }>();
  for (const row of rows) {
    const group = grouped.get(row.value) || {
      value: row.value,
      count: 0,
      labels: new Set<string>(),
    };
    group.count += Number(row.count || 0);
    group.labels.add(chinese ? geographyLabel({ ...row, city: row.value }) : row.value);
    // A raw city equality condition also selects its explicit homonyms across provinces.
    if (chinese) {
      for (const entry of cityDefinitions) {
        if (entry.aliases.some(alias => geographyAlias(alias) === geographyAlias(row.value || '')))
          group.labels.add(entry.name);
      }
    }
    grouped.set(row.value, group);
  }
  return [...grouped.values()].map(({ value, count, labels }) => ({
    value,
    count,
    label: [...labels].join(' / '),
  }));
}

export type Geography = { country?: string | null; region?: string | null; city?: string | null };
export function identifyCity(value: Geography) {
  const country = normalizeCountryCode(value.country?.trim());
  const region = geographyRegion(value.region, value.country);
  const catalogueCountry =
    country === 'CN' && region === 'CN-91'
      ? 'HK'
      : country === 'CN' && region === 'CN-92'
        ? 'MO'
        : country;
  const rawCity = value.city?.normalize('NFC').trim() || null;
  const candidates = rawCity
    ? (cityAliases.get(JSON.stringify([catalogueCountry, geographyAlias(rawCity)])) || []).filter(
        city =>
          region
            ? city.region === region || (!city.region && city.country !== 'CN')
            : !requiresRegion(city.country, rawCity),
      )
    : [];
  const known = candidates.length === 1 ? candidates[0] : undefined;
  return {
    country: country || null,
    region,
    city: rawCity,
    cityId: known?.id || null,
    name: known?.name || rawCity,
    // Observed province remains part of identity, including when it is missing.
    key: JSON.stringify([country || null, region, known?.id || rawCity]),
  };
}

export function geographyLabel(value: Geography) {
  const city = identifyCity(value);
  if (city.name) return city.name;
  if (city.region) return `${regionName(city.region, city.country)} · 城市未知`;
  if (city.country) return `${countryName(city.country)} · 城市未知`;
  return '地域未知';
}

export function visitorGeographyLabel(value: Geography) {
  const city = identifyCity(value);
  if (!city.name) return geographyLabel(value);
  return [
    city.name,
    city.region ? regionName(city.region, city.country) : null,
    city.country ? countryName(city.country) : null,
  ]
    .filter(Boolean)
    .join('，');
}

export type GeographyFact = Geography & {
  sessions: number;
  pv?: number;
  bounces: number;
  conversions: number;
  duration: number | null;
  durationTotal?: number;
  durationSamples?: number;
};

export type GeographyCoverage = {
  displayRuleVersion: string;
  totalVisits: number;
  cityKnownVisits: number;
  cityUnknownVisits: number;
  cityCoverage: number | null;
  chinaVisits: number;
  chinaProvinceKnownVisits: number;
  chinaProvinceUnknownVisits: number;
  chinaProvinceCoverage: number | null;
  cityDisplayState: 'empty' | 'unidentified' | 'available';
  provinceDisplayState: 'empty' | 'unidentified' | 'available';
};

export function geographyCoverage(rows: GeographyFact[], totalVisits: number): GeographyCoverage {
  const count = (predicate: (row: GeographyFact) => boolean) =>
    rows.reduce(
      (sum, row) => sum + (predicate(row) ? Math.max(0, Number(row.sessions) || 0) : 0),
      0,
    );
  const total = Math.max(0, totalVisits);
  const cityKnownVisits = Math.min(
    total,
    count(row => !!identifyCity(row).city),
  );
  const chinaVisits = count(row => normalizeCountryCode(row.country) === 'CN');
  const chinaProvinceKnownVisits = count(
    row => normalizeCountryCode(row.country) === 'CN' && !!geographyRegion(row.region, 'CN'),
  );
  const percent = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : null);
  return {
    displayRuleVersion: geographyDisplayRuleVersion,
    totalVisits: total,
    cityKnownVisits,
    cityUnknownVisits: total - cityKnownVisits,
    cityCoverage: percent(cityKnownVisits, total),
    chinaVisits,
    chinaProvinceKnownVisits,
    chinaProvinceUnknownVisits: chinaVisits - chinaProvinceKnownVisits,
    chinaProvinceCoverage: percent(chinaProvinceKnownVisits, chinaVisits),
    cityDisplayState: !total ? 'empty' : cityKnownVisits ? 'available' : 'unidentified',
    provinceDisplayState: !chinaVisits
      ? 'empty'
      : chinaProvinceKnownVisits
        ? 'available'
        : 'unidentified',
  };
}

export function geographyCoverageText(coverage?: GeographyCoverage) {
  const rule = '仅展示有城市信息的访问，占比按全部有效访问计算。';
  if (!coverage) return `${rule} 城市覆盖情况暂不可用`;
  if (!coverage.totalVisits) return `${rule} 当前期间暂无访问数据`;
  return `${rule} 城市覆盖 ${coverage.cityCoverage}% · ${coverage.cityUnknownVisits.toLocaleString('zh-CN')} 次访问城市未识别`;
}

export function geographyEmptyText(coverage?: GeographyCoverage, search = '') {
  if (!coverage) return '城市覆盖情况暂不可用';
  if (!coverage.totalVisits) return '当前期间暂无访问数据';
  if (!coverage.cityKnownVisits) return '已收到访问数据，城市信息尚未识别';
  return search ? '没有匹配的城市' : '当前期间暂无城市记录';
}
export function mergeGeography(rows: GeographyFact[]) {
  const groups = new Map<
    string,
    GeographyFact &
      ReturnType<typeof identifyCity> & {
        durationTotal: number;
        durationSamples: number;
      }
  >();
  for (const row of rows) {
    const identity = identifyCity(row);
    const group = groups.get(identity.key) || {
      ...identity,
      sessions: 0,
      pv: 0,
      bounces: 0,
      conversions: 0,
      duration: null,
      durationTotal: 0,
      durationSamples: 0,
    };
    for (const key of ['sessions', 'pv', 'bounces', 'conversions'] as const)
      group[key] += Number(row[key] || 0);
    group.durationTotal += Number(row.durationTotal ?? (row.duration ?? 0) * row.sessions);
    group.durationSamples += Number(
      row.durationSamples ?? (row.duration == null ? 0 : row.sessions),
    );
    group.duration = group.durationSamples ? group.durationTotal / group.durationSamples : null;
    groups.set(identity.key, group);
  }
  return [...groups.values()].sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key));
}

export const geographySorts = [
  'city',
  'sessions',
  'share',
  'duration',
  'bounceRate',
  'conversionRate',
] as const;
export type GeographySelection = {
  search?: string;
  geoSort?: (typeof geographySorts)[number];
  direction?: 'asc' | 'desc';
};
export function geographyTable(
  rows: GeographyFact[],
  visits: number,
  hasGoals: boolean,
  selection: GeographySelection = {},
) {
  const percent = (count: number, total: number) =>
    total ? Math.round((count / total) * 10000) / 100 : null;
  const query = geographyAlias(selection.search || '');
  const facts = mergeGeography(rows)
    .filter(row => !!row.city)
    .filter(
      row =>
        !query ||
        [
          geographyLabel(row),
          row.city,
          ...regionAliases(row.region, row.country),
          regionName(row.region, row.country),
          countryName(row.country),
          ...(cityDefinitions.find(city => city.id === row.cityId)?.aliases || []),
        ].some(value => value && geographyAlias(value).includes(query)),
    );
  const selected = facts.map(row => ({
    city: geographyLabel(row),
    sessions: row.sessions,
    share: percent(row.sessions, visits),
    duration: row.duration,
    bounceRate: percent(row.bounces, row.sessions),
    conversionRate: hasGoals ? percent(row.conversions, row.sessions) : null,
    key: row.key,
  }));
  const field = selection.geoSort || 'sessions',
    direction = selection.direction === 'asc' ? 1 : -1;
  return selected
    .sort((a, b) => {
      const left = a[field],
        right = b[field];
      if (left == null || right == null)
        return left == null && right == null ? a.key.localeCompare(b.key) : left == null ? 1 : -1;
      return (
        (typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right, 'zh-CN')
          : Number(left) - Number(right)) * direction || a.key.localeCompare(b.key)
      );
    })
    .map(({ key, ...row }) => row);
}
