import type { CrawlerObservationQuality } from '../contracts/crawlers';
import type { GeoFactors, GeoPurpose, GeoReason, GeoWeightPoint } from '../contracts/geo-weight';
import { GEO_PURPOSES } from './policy';
import { emptyGeoFactors, geoScore } from './score';

export function geoPoint(
  window: Pick<GeoWeightPoint, 'asOf' | 'startAt' | 'endAt'>,
  row: Record<string, any>,
  quality: CrawlerObservationQuality,
  fallback: boolean,
  coveredEvidence: boolean,
): GeoWeightPoint {
  const s = row.stats || {};
  const observedRequests = (s.requests || 0) - (row.exclusions?.self_check || 0);
  const factors = Object.fromEntries(GEO_PURPOSES.map(p => [p, emptyGeoFactors()])) as Record<
    GeoPurpose,
    GeoFactors
  >;
  for (const f of row.factors || []) {
    if (GEO_PURPOSES.includes(f.purpose))
      factors[f.purpose] = {
        paths: f.paths,
        units: f.units,
        days: f.days,
        operators: f.operators,
      };
  }
  const computed = geoScore(factors);
  const reasons: GeoReason[] = [];
  const add = (condition: boolean, reason: GeoReason) => {
    if (condition) reasons.push(reason);
  };
  add(
    quality.state !== 'complete',
    quality.state === 'partial' ? 'coverage_partial' : 'coverage_missing',
  );
  add(quality.state === 'complete' && !coveredEvidence, 'coverage_missing');
  add((!coveredEvidence && !(observedRequests > 0)) || s.samplingUnknown > 0, 'sampling_unknown');
  add(s.inferredHost > 0 || !(observedRequests > 0), 'host_inferred');
  add(s.historyMissing > 0, 'history_incomplete');
  add(s.identityMissing > 0, 'identity_incomplete');
  add((s.classificationVersions?.length || 0) > 1, 'classification_changed');
  add((s.sources?.length || 0) > 1, 'source_changed');
  add(fallback, 'catalog_fallback');
  add(s.pathInferred > 0, 'content_inferred');
  add(s.pathInferred > 0 && s.mimeConfirmed > 0, 'content_mixed');
  const observedDays = coveredEvidence
    ? 30
    : s.firstEvidenceDay
      ? Math.max(
          0,
          Math.min(
            30,
            Math.round((Date.parse(window.asOf) - Date.parse(s.firstEvidenceDay)) / 86400000) + 1,
          ),
        )
      : 0;
  const zero =
    !(s.accepted > 0) &&
    quality.state === 'complete' &&
    coveredEvidence &&
    !s.identityMissing &&
    !s.historyMissing;
  const state =
    !(observedRequests > 0) && !coveredEvidence
      ? 'missing'
      : zero
        ? 'observed_zero'
        : !(s.accepted > 0)
          ? 'unavailable'
          : observedDays < 30
            ? 'warming_up'
            : reasons.length
              ? 'reference'
              : 'aligned';
  const numeric = !['missing', 'unavailable'].includes(state);
  const comparableKey =
    state === 'aligned' || (state === 'observed_zero' && !reasons.length)
      ? JSON.stringify([
          quality.classificationVersion,
          quality.sourceVersion,
          s.classificationVersions,
          s.sources,
          s.pathInferred ? 'path' : 'mime',
        ])
      : null;
  return {
    ...window,
    state,
    weightedUnits: numeric ? computed.weightedUnits : null,
    level: numeric && state !== 'warming_up' ? computed.level : null,
    observedDays,
    reasons,
    categories: computed.categories,
    requests: s.requests || 0,
    accepted: s.accepted || 0,
    status200: s.status200 || 0,
    status304: s.status304 || 0,
    mimeConfirmed: s.mimeConfirmed || 0,
    pathInferred: s.pathInferred || 0,
    exclusions: row.exclusions || {},
    operators: row.operators || [],
    identities: row.identities || [],
    forms: row.forms || [],
    catalogVersions: s.catalogVersions || [],
    classificationVersions: s.classificationVersions || [],
    sources: s.sources || [],
    comparableKey,
  };
}
export function geoComparable(a: GeoWeightPoint, b: GeoWeightPoint) {
  return (
    !!a.comparableKey && a.comparableKey === b.comparableKey && a.level !== null && b.level !== null
  );
}
