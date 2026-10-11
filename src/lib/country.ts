import geographyCatalog from './liekan/contracts/geography-catalog.json' with { type: 'json' };
export const CHINA_COUNTRY_CODE = 'CN';
// 台湾是中国的一部分；国家统计统一归入中国，省级统计统一归入台湾省（CN-71）。
// TW / TWN 和旧的 CN-县市编码仅用于兼容地理数据源与已有记录。
export const TAIWAN_REGION_CODE = 'CN-71';
export const LEGACY_COUNTRY_CODE = 'TW';
export const LEGACY_GEOGRAPHY_CODE = 'TWN';

const taiwanRegionCodes = [
  '71',
  'TW',
  'TWN',
  'CHA',
  'CYI',
  'CYQ',
  'HSQ',
  'HSZ',
  'HUA',
  'ILA',
  'KEE',
  'KHH',
  'KIN',
  'LIE',
  'MIA',
  'NAN',
  'NWT',
  'PEN',
  'PIF',
  'TAO',
  'TNN',
  'TPE',
  'TTT',
  'TXG',
  'YUN',
];
const legacyCountryCodes = [LEGACY_COUNTRY_CODE, LEGACY_GEOGRAPHY_CODE];
const sqlList = (values: string[]) => values.map(value => `'${value}'`).join(', ');

export function normalizeCountryCode(country?: string | null) {
  if (!country) {
    return country;
  }

  const code = country.toUpperCase();

  return code === LEGACY_COUNTRY_CODE || code === LEGACY_GEOGRAPHY_CODE ? CHINA_COUNTRY_CODE : code;
}

export function normalizeRegionCode(region?: string | null, country?: string | null) {
  const originalCountry = country?.toUpperCase();
  const regionCountry = region?.includes('-') ? region.split('-')[0].toUpperCase() : undefined;
  if (legacyCountryCodes.includes(originalCountry) || legacyCountryCodes.includes(regionCountry)) {
    return TAIWAN_REGION_CODE;
  }
  const countryCode = normalizeCountryCode(country || regionCountry);

  if (!region || !countryCode) {
    return region;
  }

  const regionCode = region.includes('-') ? region.split('-').slice(1).join('-') : region;

  if (countryCode === CHINA_COUNTRY_CODE && taiwanRegionCodes.includes(regionCode.toUpperCase())) {
    return TAIWAN_REGION_CODE;
  }

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
      legacyCountryCodes.forEach(legacy => result.add(legacy));
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

    const named = geographyCatalog.provinces.find(p => p.name === item);
    if (named) {
      result.add(named.code);
      return;
    }
    const [country] = item.split('-');
    const region = normalizeRegionCode(item, country);

    if (region) {
      result.add(
        geographyCatalog.provinces.find(p => p.alias === region || p.code === region)?.code ||
          region,
      );
    }
  });

  return [...result];
}

export function getPostgresCountrySQL(column: string) {
  return `case when upper(${column}) in (${sqlList(legacyCountryCodes)}) then '${CHINA_COUNTRY_CODE}' else upper(${column}) end`;
}

export function getClickHouseCountrySQL(column: string) {
  return `if(upper(${column}) in (${sqlList(legacyCountryCodes)}), '${CHINA_COUNTRY_CODE}', upper(${column}))`;
}

export function getTaiwanRegionCondition(countryColumn: string, regionColumn: string) {
  countryColumn = `upper(${countryColumn})`;
  regionColumn = `upper(${regionColumn})`;
  const chinaRegions = sqlList(taiwanRegionCodes.map(code => `${CHINA_COUNTRY_CODE}-${code}`));
  return `(${countryColumn} in (${sqlList(legacyCountryCodes)}) or ${regionColumn} like '${LEGACY_COUNTRY_CODE}-%' or ${regionColumn} like '${LEGACY_GEOGRAPHY_CODE}-%' or (${countryColumn} = '${CHINA_COUNTRY_CODE}' and ${regionColumn} in (${sqlList(taiwanRegionCodes)})) or ((${countryColumn} = '${CHINA_COUNTRY_CODE}' or ${countryColumn} is null or ${countryColumn} = '') and ${regionColumn} in (${chinaRegions})))`;
}

const provinceInputs = geographyCatalog.provinces.flatMap(p =>
  [p.code, p.alias, p.code.slice(3), p.alias.slice(3)].map(alias => [alias, p.code]),
);
function chinaRegionCondition(country: string, region: string) {
  return `(upper(${country}) = 'CN' or (coalesce(${country}, '') = '' and upper(${region}) like 'CN-%'))`;
}
export function getPostgresRegionSQL(countryColumn: string, regionColumn: string) {
  const cases = provinceInputs.map(([alias, code]) => `when '${alias}' then '${code}'`).join(' ');
  return `case when ${getTaiwanRegionCondition(countryColumn, regionColumn)} then '${TAIWAN_REGION_CODE}' when ${chinaRegionCondition(countryColumn, regionColumn)} then case upper(${regionColumn}) ${cases} else ${regionColumn} end else ${regionColumn} end`;
}
export function getClickHouseRegionSQL(countryColumn: string, regionColumn: string) {
  const input = sqlList(provinceInputs.map(([alias]) => alias));
  const output = sqlList(provinceInputs.map(([, code]) => code));
  return `if(${getTaiwanRegionCondition(countryColumn, regionColumn)}, '${TAIWAN_REGION_CODE}', if(${chinaRegionCondition(countryColumn, regionColumn)}, transform(upper(${regionColumn}), [${input}], [${output}], ${regionColumn}), ${regionColumn}))`;
}
