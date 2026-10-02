export const CHINA_COUNTRY_CODE = 'CN';
export const LEGACY_COUNTRY_CODE = ['T', 'W'].join('');
export const LEGACY_GEOGRAPHY_CODE = `${LEGACY_COUNTRY_CODE}N`;

export function normalizeCountryCode(country?: string | null) {
  if (!country) {
    return country;
  }

  const code = country.toUpperCase();

  return code === LEGACY_COUNTRY_CODE || code === LEGACY_GEOGRAPHY_CODE ? CHINA_COUNTRY_CODE : code;
}

export function normalizeRegionCode(region?: string | null, country?: string | null) {
  const countryCode = normalizeCountryCode(country);

  if (!region || !countryCode) {
    return region;
  }

  const regionCode = region.includes('-') ? region.split('-').slice(1).join('-') : region;

  return `${countryCode}-${regionCode}`;
}

export function getCountryFilterValues(value: any) {
  const values = Array.isArray(value) ? value : [value];
  const result = new Set<any>();

  values.forEach(item => {
    if (typeof item !== 'string') {
      result.add(item);
      return;
    }

    const code = normalizeCountryCode(item);

    if (code) {
      result.add(code);
    }

    if (code === CHINA_COUNTRY_CODE) {
      result.add(LEGACY_COUNTRY_CODE);
    }
  });

  return [...result];
}

export function getRegionFilterValues(value: any) {
  const values = Array.isArray(value) ? value : [value];
  const result = new Set<any>();

  values.forEach(item => {
    if (typeof item !== 'string') {
      result.add(item);
      return;
    }

    const [country] = item.split('-');
    const region = normalizeRegionCode(item, country);

    if (region) {
      result.add(region);
    }

    if (region?.startsWith(`${CHINA_COUNTRY_CODE}-`)) {
      result.add(region.replace(`${CHINA_COUNTRY_CODE}-`, `${LEGACY_COUNTRY_CODE}-`));
    }
  });

  return [...result];
}

export function getPostgresCountrySQL(column: string) {
  return `case when ${column} = '${LEGACY_COUNTRY_CODE}' then '${CHINA_COUNTRY_CODE}' else ${column} end`;
}

export function getClickHouseCountrySQL(column: string) {
  return `if(${column} = '${LEGACY_COUNTRY_CODE}', '${CHINA_COUNTRY_CODE}', ${column})`;
}

export function getPostgresRegionSQL(countryColumn: string, regionColumn: string) {
  return `case when ${regionColumn} like '${LEGACY_COUNTRY_CODE}-%' then '${CHINA_COUNTRY_CODE}-' || substring(${regionColumn} from 4) when ${countryColumn} = '${LEGACY_COUNTRY_CODE}' and ${regionColumn} != '' then '${CHINA_COUNTRY_CODE}-' || ${regionColumn} else ${regionColumn} end`;
}

export function getClickHouseRegionSQL(countryColumn: string, regionColumn: string) {
  return `multiIf(startsWith(${regionColumn}, '${LEGACY_COUNTRY_CODE}-'), concat('${CHINA_COUNTRY_CODE}-', substring(${regionColumn}, 4)), ${countryColumn} = '${LEGACY_COUNTRY_CODE}' and ${regionColumn} != '', concat('${CHINA_COUNTRY_CODE}-', ${regionColumn}), ${regionColumn})`;
}
