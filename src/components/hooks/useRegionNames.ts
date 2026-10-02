import { normalizeCountryCode, normalizeRegionCode } from '@/lib/country';
import regions from '../../../public/iso-3166-2.json';
import { useCountryNames } from './useCountryNames';

export function useRegionNames(locale: string) {
  const { countryNames } = useCountryNames(locale);

  const getRegionName = (regionCode: string, countryCode?: string) => {
    if (!regionCode) {
      return null;
    }

    if (!countryCode) {
      const [country] = regionCode.split('-');
      const normalizedCountry = normalizeCountryCode(country);
      const region = normalizeRegionCode(regionCode, normalizedCountry);
      const regionName = regions[region];

      return regionName && normalizedCountry
        ? `${regionName}, ${countryNames[normalizedCountry]}`
        : regionName || region;
    }

    const country = normalizeCountryCode(countryCode);
    const region = normalizeRegionCode(regionCode, country);
    const regionName = regions[region];

    return regionName ? `${regionName}, ${countryNames[country]}` : region;
  };

  return { regionNames: regions, getRegionName };
}
