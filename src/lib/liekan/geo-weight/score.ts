import type { GeoFactors, GeoPurpose } from '../contracts/geo-weight';
import { GEO_COEFFICIENTS, GEO_LEVEL_MINIMUMS, GEO_PURPOSES } from './policy';

export const emptyGeoFactors = (): GeoFactors => ({ paths: 0, units: 0, days: 0, operators: 0 });
export function geoLevel(weightedUnits: number) {
  if (!Number.isSafeInteger(weightedUnits) || weightedUnits < 0)
    throw new RangeError('Invalid GEO activity');
  return GEO_LEVEL_MINIMUMS.filter(minimum => weightedUnits >= minimum).length;
}
export function geoScore(factors: Record<GeoPurpose, GeoFactors>) {
  const categories = GEO_PURPOSES.map(purpose => {
    const value = factors[purpose];
    if (Object.values(value).some(x => !Number.isSafeInteger(x) || x < 0) || value.days > 30)
      throw new RangeError('Invalid GEO factors');
    const coefficient = GEO_COEFFICIENTS[purpose];
    return { ...value, purpose, coefficient, weightedUnits: value.units * coefficient };
  });
  const weightedUnits = categories.reduce((sum, row) => sum + row.weightedUnits, 0);
  return { weightedUnits, level: geoLevel(weightedUnits), categories };
}
