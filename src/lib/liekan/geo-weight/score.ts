import type { GeoFactors, GeoPurpose } from '../contracts/geo-weight';
import { GEO_ANCHORS, GEO_FORMULA, GEO_PURPOSES, GEO_WEIGHTS } from './policy';

export const emptyGeoFactors = (): GeoFactors => ({ paths: 0, units: 0, days: 0, operators: 0 });
export function geoScore(factors: Record<GeoPurpose, GeoFactors>) {
  const log = (x: number, anchor: number) => Math.min(1, Math.log1p(x) / Math.log1p(anchor));
  const categories = GEO_PURPOSES.map(purpose => {
    const value = factors[purpose];
    if (Object.values(value).some(x => !Number.isSafeInteger(x) || x < 0) || value.days > 30)
      throw new RangeError('Invalid GEO factors');
    const f = GEO_FORMULA;
    const score =
      100 *
      (f.pathWeight * log(value.paths, f.paths) +
        f.unitWeight * log(value.units, f.units) +
        f.operatorWeight * Math.min(value.operators / GEO_ANCHORS[purpose], 1)) *
      (f.continuityBase + ((1 - f.continuityBase) * value.days) / f.days);
    return {
      ...value,
      purpose,
      score,
      contribution: score * GEO_WEIGHTS[purpose],
      weight: GEO_WEIGHTS[purpose],
      operatorAnchor: GEO_ANCHORS[purpose],
    };
  });
  const stable = Math.round(categories.reduce((sum, row) => sum + row.contribution, 0) * 1e8);
  const score = Math.floor((stable + 5e6) / 1e7) / 10;
  return {
    rawScore: stable / 1e8,
    score,
    level: score === 0 ? 0 : Math.ceil(score / 10),
    categories,
  };
}
