'use client';
import { useEffect, useState } from 'react';
import { useGeoWeight } from '@/lib/liekan/contracts/geo-weight-client';
import { geoAsOf } from '@/lib/liekan/geo-weight/window';
import {
  geoPurposeLabels,
  geoPointStateLabel,
  geoReasonLabels,
} from '@/lib/liekan/contracts/geo-weight-labels';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { GeoWeightDetails } from './GeoWeightDetails';
import styles from '@/styles/liekan/GeoWeight.module.css';

export function GeoWeightSummary(props: {
  userId: string;
  websiteId: string;
  endAt: number;
  timezone: string;
  readAt: number;
  expanded?: boolean;
}) {
  const asOf = geoAsOf(props.endAt, props.timezone, props.readAt);
  return (
    <GeoWeightRead
      key={`${props.userId}:${props.websiteId}:${asOf}:${props.timezone}`}
      {...props}
      asOf={asOf}
    />
  );
}
function GeoWeightRead({
  userId,
  websiteId,
  asOf,
  timezone,
  expanded,
}: {
  userId: string;
  websiteId: string;
  asOf: string;
  timezone: string;
  expanded?: boolean;
}) {
  const i18n = useLiekanI18n();
  const [open, setOpen] = useState(false);
  const [detailRequested, setDetailRequested] = useState(false);
  const [blocked, setBlocked] = useState<{
    status: number;
    summaryAt: number;
    detailAt: number;
  } | null>(null);
  const summary = useGeoWeight(userId, websiteId, asOf, timezone, 'summary');
  const detail = useGeoWeight(
    userId,
    websiteId,
    asOf,
    timezone,
    'detail',
    open || (detailRequested && !!blocked),
  );
  const error = summary.error as { status?: number; message?: string } | null;
  const detailError = detail.error as { status?: number; message?: string } | null;
  const restricted =
    [401, 403, 404].includes(error?.status) ||
    [401, 403, 404].includes(detailError?.status) ||
    [401, 403, 404].includes(blocked?.status);
  const invalidated = error?.status === 409 || detailError?.status === 409 || !!blocked;
  const sameScope = (value: typeof detail.data) =>
    value?.websiteId === websiteId && value.current.asOf === asOf && value.timezone === timezone;
  const useDetail =
    !invalidated &&
    !detail.isError &&
    !detail.isPlaceholderData &&
    sameScope(detail.data) &&
    (!summary.data ||
      (detail.data.epoch === summary.data.epoch &&
        detail.data.calculatedAt >= summary.data.calculatedAt));
  const data =
    restricted || invalidated
      ? undefined
      : useDetail
        ? detail.data
        : sameScope(summary.data)
          ? summary.data
          : undefined;
  const boundaryStatus = [error?.status, detailError?.status].find(status =>
    [401, 403, 404, 409].includes(status),
  );
  useEffect(() => {
    if (boundaryStatus)
      setBlocked({
        status: boundaryStatus,
        summaryAt: summary.dataUpdatedAt,
        detailAt: detail.dataUpdatedAt,
      });
  }, [boundaryStatus, summary.errorUpdatedAt, detail.errorUpdatedAt]);
  useEffect(() => {
    if (
      blocked &&
      !boundaryStatus &&
      summary.isSuccess &&
      !summary.isPlaceholderData &&
      sameScope(summary.data) &&
      summary.dataUpdatedAt > blocked.summaryAt &&
      (!open ||
        (detail.isSuccess &&
          !detail.isPlaceholderData &&
          sameScope(detail.data) &&
          detail.dataUpdatedAt > blocked.detailAt &&
          detail.data.epoch === summary.data.epoch))
    )
      setBlocked(null);
  }, [
    blocked,
    boundaryStatus,
    summary.isSuccess,
    summary.dataUpdatedAt,
    summary.isPlaceholderData,
    detail.isSuccess,
    detail.dataUpdatedAt,
    detail.isPlaceholderData,
    open,
  ]);
  const current = data?.current;
  const stale = summary.isError || summary.isPlaceholderData;
  const num = (value: number, digits = 1) =>
    value.toLocaleString(i18n.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const reload = async () => {
    await summary.refetch();
    if (open || [401, 403, 404, 409].includes(detailError?.status)) await detail.refetch();
  };
  return (
    <section
      className={styles.summary}
      data-geo-weight
      aria-label={i18n.text('GEO 权重')}
      aria-busy={summary.isFetching}
    >
      <div className={styles.heading}>
        <h2 className={styles.title}>
          {i18n.text('GEO 权重')} <span className={styles.badge}>Beta</span>
        </h2>
        <p className={styles.caption}>{i18n.text('AI 抓取版 · 网站整体')}</p>
        <p className={styles.caption}>
          {i18n.text('截至 {v0} 的 30 个完整自然日', [asOf])} · {timezone}
        </p>
      </div>
      <div className={styles.readout} role="status">
        {restricted ? (
          <p>{i18n.text('访问权限已变更，请重新打开页面')}</p>
        ) : current ? (
          <>
            <strong className={styles.score}>
              {current.score === null ? i18n.text('暂无评分') : `${num(current.score)} / 100`}
            </strong>
            <span>
              {i18n.text(geoPointStateLabel(current))}
              {current.level !== null && ` · ${i18n.text('{v0} / 10 级', [current.level])}`}
            </span>
            {current.state === 'warming_up' && (
              <span>{i18n.text('观察跨度 {v0} / 30 日', [current.observedDays])}</span>
            )}
            {current.reasons.length > 0 && (
              <span className={styles.caption}>
                {current.reasons
                  .slice(0, 2)
                  .map(r => i18n.text(geoReasonLabels[r]))
                  .join(' · ')}
              </span>
            )}
          </>
        ) : (
          <span>
            {i18n.text(
              summary.isError || invalidated
                ? 'GEO 权重计算未完成，请重新读取'
                : '正在计算 GEO 权重',
            )}
          </span>
        )}
        {!restricted && stale && data && (
          <p className={styles.warning}>
            {i18n.text('当前读取未完成，保留上次计算结果')}
            {data &&
              ` · ${new Date(data.calculatedAt).toLocaleString(i18n.locale, { timeZone: timezone })}`}
          </p>
        )}
        {expanded && current && !restricted && (
          <div className={styles.types}>
            {current.categories.map(c => (
              <span key={c.purpose}>
                {i18n.text(geoPurposeLabels[c.purpose])} {num(c.score, 2)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={restricted || !data}
          onClick={() => {
            setDetailRequested(true);
            setOpen(true);
          }}
        >
          {i18n.text('查看计算依据')}
        </button>
        {(summary.isError || invalidated) && !restricted && (
          <button type="button" onClick={reload}>
            {i18n.text('重新读取')}
          </button>
        )}
      </div>
      {open && !restricted && (
        <GeoWeightDetails
          data={useDetail ? detail.data : undefined}
          error={
            invalidated || (!!detail.data && !useDetail && !detail.isFetching)
              ? detail.error ||
                summary.error ||
                new Error(i18n.text('GEO 权重计算未完成，请重新读取'))
              : detail.error
          }
          loading={detail.isFetching}
          stale={detail.isPlaceholderData || !!blocked}
          onClose={() => setOpen(false)}
          onReload={reload}
          onExportConflict={status =>
            setBlocked({ status, summaryAt: summary.dataUpdatedAt, detailAt: detail.dataUpdatedAt })
          }
        />
      )}
    </section>
  );
}
