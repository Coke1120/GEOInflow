'use client';
import type { GeoWeightResponse } from '../contracts/geo-weight';
import { useManualQuery } from '../contracts/manual-refresh';
import { featureApi, downloadTrafficEvidence } from './features-client';
export function useGeoWeight(
  userId: string,
  websiteId: string,
  asOf: string,
  timezone: string,
  view: 'summary' | 'detail',
  enabled = true,
) {
  return useManualQuery<GeoWeightResponse>({
    queryKey: ['liekan-feature', userId, 'geo-weight', websiteId, asOf, timezone, view],
    queryFn: ({ signal }) =>
      featureApi.get(
        `/liekan/websites/${websiteId}/geo-weight`,
        // An explicit detail read must not reuse evidence older than the visible summary.
        { asOf, timezone, view, ...(view === 'detail' ? { refresh: 1 } : {}) },
        signal,
      ),
    enabled: enabled && !!userId && !!websiteId,
  });
}
export function downloadGeoWeight(data: GeoWeightResponse, locale: string, signal: AbortSignal) {
  return downloadTrafficEvidence(
    `/liekan/websites/${data.websiteId}/geo-weight/export`,
    {
      asOf: data.current.asOf,
      timezone: data.timezone,
      locale,
      catalogVersion: data.readCatalogVersion,
      snapshot: data.snapshot,
    },
    signal,
    data.readCatalogVersion,
  );
}
