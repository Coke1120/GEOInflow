'use client';
import { useEffect, useRef, useState } from 'react';
import { useGeoWeight } from '@/lib/liekan/contracts/geo-weight-client';
import { canonicalGeoTimezone, geoAsOf } from '@/lib/liekan/geo-weight/window';
import { geoPointStateLabel } from '@/lib/liekan/contracts/geo-weight-labels';
import type { GeoWeightSnapshotResponse } from '@/lib/liekan/contracts/geo-weight';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { GeoWeightDetails } from './GeoWeightDetails';
import { Skeleton, useDataLoading } from '../DataLoading';
import styles from '@/styles/liekan/GeoWeight.module.css';

const BOUNDARY = [401, 403, 404, 409, 410];
export function GeoWeightSummary(props: {
  userId: string;
  websiteId: string;
  endAt: number;
  timezone: string;
  readAt: number;
}) {
  const selected = geoAsOf(props.endAt, props.timezone, props.readAt);
  const current = geoAsOf(props.readAt, props.timezone, props.readAt);
  const asOf = selected < current ? selected : undefined;
  return (
    <GeoWeightRead
      key={`${props.userId}:${props.websiteId}:${asOf || 'current'}:${props.timezone}`}
      {...props}
      asOf={asOf}
    />
  );
}
export function GeoWeightPlaceholder({
  failed = false,
  onReload,
}: {
  failed?: boolean;
  onReload?: () => void;
}) {
  const i18n = useLiekanI18n();
  const reportLoading = useDataLoading();
  return (
    <section
      className={`card fade-in d1 ${styles.summary}`}
      aria-busy={!failed}
      aria-label={i18n.text('GEO 权重')}
    >
      <p className={styles.title} data-liekan-metric-label>
        {i18n.text('GEO 权重')}
      </p>
      <div
        className={styles.readout}
        role={failed || !reportLoading ? 'status' : undefined}
        aria-label={i18n.text(failed ? '无法读取数据展示设置' : '正在读取 GEO 权重')}
      >
        {failed ? (
          <span className={styles.statusValue}>{i18n.text('无法读取数据展示设置')}</span>
        ) : (
          <Skeleton width="3em" height="24px" />
        )}
      </div>
      {failed ? (
        <button className={styles.retryButton} type="button" onClick={onReload}>
          {i18n.text('重新读取')}
        </button>
      ) : (
        <p className={styles.metadata}>
          <Skeleton width="85%" height="1em" />
        </p>
      )}
    </section>
  );
}
function GeoWeightRead({
  userId,
  websiteId,
  asOf,
  timezone,
  readAt,
}: {
  userId: string;
  websiteId: string;
  asOf?: string;
  timezone: string;
  readAt: number;
}) {
  const i18n = useLiekanI18n();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState<GeoWeightSnapshotResponse | null>(null);
  const [blocked, setBlocked] = useState<{ status: number; summaryAt: number } | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [recalculateError, setRecalculateError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const requestId = useRef<string>(null);
  const controller = useRef<AbortController>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setTimeout(() => setCooldownUntil(0), Math.max(0, cooldownUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [cooldownUntil]);
  const summary = useGeoWeight(userId, websiteId, asOf, timezone, 'summary');
  const envelope = summary.data;
  const snapshotId = envelope?.snapshotId;
  const detailEnvelope = open && pinned?.snapshotId ? pinned : envelope;
  const detailSnapshotId = detailEnvelope?.snapshotId;
  const detail = useGeoWeight(
    userId,
    websiteId,
    asOf,
    timezone,
    'detail',
    !!detailSnapshotId && (open || !!blocked),
    detailSnapshotId || undefined,
  );
  const [verifiedPin, setVerifiedPin] = useState<string | null>(null);
  const pinCheck =
    open &&
    pinned?.snapshotId &&
    envelope &&
    (pinned.strongVersion !== envelope.strongVersion ||
      pinned.requestedAsOf !== envelope.requestedAsOf)
      ? JSON.stringify([pinned.snapshotId, envelope.requestedAsOf, envelope.strongVersion])
      : null;
  const checkingPin = !!pinCheck && verifiedPin !== pinCheck;
  const revalidateDetail = useRef(detail.refetch);
  revalidateDetail.current = detail.refetch;
  useEffect(() => {
    if (!pinCheck) return;
    let active = true;
    void revalidateDetail
      .current({ cancelRefetch: true })
      .then(result => {
        if (
          active &&
          !result.error &&
          result.data?.snapshotId === detailSnapshotId &&
          sameScope(result.data)
        )
          setVerifiedPin(pinCheck);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pinCheck]);
  const error = summary.error as { status?: number } | null;
  const detailError = detail.error as { status?: number } | null;
  const sameScope = (value?: GeoWeightSnapshotResponse) =>
    !!value?.result &&
    value.result.websiteId === websiteId &&
    canonicalGeoTimezone(value.result.timezone) === canonicalGeoTimezone(timezone) &&
    value.result.current.asOf === value.servedAsOf &&
    (!asOf || (value.requestedAsOf === asOf && value.servedAsOf === asOf)) &&
    (!value.result.snapshotId || value.result.snapshotId === value.snapshotId);
  const detailMatches =
    sameScope(detail.data) &&
    detail.data.snapshotId === detailSnapshotId &&
    detail.data.result.epoch === detailEnvelope?.result?.epoch;
  const mismatch =
    !!detailSnapshotId && !!detail.data && !detail.isFetching && !detail.isError && !detailMatches;
  const changedBoundary =
    !!pinned?.result &&
    !!envelope?.result &&
    (pinned.result.epoch !== envelope.result.epoch ||
      pinned.result.hostname !== envelope.result.hostname ||
      pinned.result.algorithm !== envelope.result.algorithm ||
      pinned.result.scoreScopeHash !== envelope.result.scoreScopeHash);
  const boundaryStatus = [
    error?.status,
    detailError?.status,
    mismatch || changedBoundary ? 409 : undefined,
  ].find(status => BOUNDARY.includes(status));
  const restricted = [401, 403, 404].includes(boundaryStatus || blocked?.status);
  const invalidated = !!boundaryStatus || !!blocked;
  useEffect(() => {
    if (boundaryStatus) setBlocked({ status: boundaryStatus, summaryAt: summary.dataUpdatedAt });
  }, [boundaryStatus, summary.errorUpdatedAt, detail.errorUpdatedAt, mismatch]);
  useEffect(() => {
    if (
      blocked &&
      !boundaryStatus &&
      summary.isSuccess &&
      summary.dataUpdatedAt > blocked.summaryAt &&
      (!open || !detailSnapshotId || (detail.isSuccess && detailMatches))
    )
      setBlocked(null);
  }, [
    blocked,
    boundaryStatus,
    summary.isSuccess,
    summary.dataUpdatedAt,
    open,
    detailSnapshotId,
    detail.isSuccess,
    detail.dataUpdatedAt,
    detailMatches,
  ]);
  const saved = !invalidated && sameScope(envelope) ? envelope.result : undefined;
  const data =
    saved &&
    !detail.isError &&
    detailMatches &&
    detailSnapshotId === snapshotId &&
    detail.data.result.view === 'detail'
      ? { ...detail.data.result, snapshotId }
      : saved
        ? { ...saved, snapshotId }
        : undefined;
  const dialogSaved =
    !invalidated && !checkingPin && sameScope(detailEnvelope) ? detailEnvelope.result : undefined;
  const dialogData =
    dialogSaved && !detail.isError && detailMatches
      ? { ...detail.data.result, snapshotId: detailSnapshotId }
      : dialogSaved
        ? { ...dialogSaved, snapshotId: detailSnapshotId }
        : undefined;
  const newerSnapshot = !!(
    open &&
    pinned?.snapshotId &&
    snapshotId &&
    pinned.snapshotId !== snapshotId
  );
  const current = data?.current;
  const readFailed = summary.isError;
  const active = ['queued', 'running'].includes(envelope?.taskStatus);
  const updateFailed = envelope?.taskStatus === 'failed';
  const capacityBlocked = envelope?.taskStatus === 'capacity_blocked';
  const num = (value: number, digits = 0) =>
    value.toLocaleString(i18n.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const time = (value: string | number) =>
    new Date(value).toLocaleString(i18n.locale, { timeZone: timezone });
  const reload = async () => {
    const result = await summary.refetch();
    if (open && result.data) setPinned(result.data);
    if ((open || !!blocked) && detailSnapshotId && result.data?.snapshotId === detailSnapshotId)
      await detail.refetch();
  };
  useEffect(() => {
    if (open && !pinned?.snapshotId && envelope?.snapshotId) setPinned(envelope);
  }, [open, pinned?.snapshotId, envelope?.snapshotId]);
  const recalculate = async () => {
    if (!envelope?.canRecalculate || invalidated || recalculating || cooldownUntil) return;
    const owned = new AbortController();
    controller.current?.abort();
    controller.current = owned;
    requestId.current ||= crypto.randomUUID();
    setRecalculating(true);
    setRecalculateError('');
    try {
      await summary.recalculate(requestId.current, owned.signal);
      if (owned.signal.aborted) return;
      requestId.current = null;
      setCooldownUntil(Date.now() + 300000);
    } catch (e: any) {
      if (owned.signal.aborted) return;
      setRecalculateError(e.message || 'GEO 权重更新失败，请重新读取');
      if (e.status === 429) setCooldownUntil(Date.now() + (e.retryAfterMs || 300000));
      if (BOUNDARY.includes(e.status))
        setBlocked({ status: e.status, summaryAt: summary.dataUpdatedAt });
      if (e.status && e.status < 500) requestId.current = null;
    } finally {
      if (!owned.signal.aborted) setRecalculating(false);
    }
  };
  const statusText = active
    ? asOf
      ? '正在计算 GEO 权重'
      : '正在更新今日权重'
    : capacityBlocked
      ? '快照存储已满，请稍后重新读取'
      : updateFailed
        ? 'GEO 权重更新失败，请重新读取'
        : summary.isError || invalidated
          ? 'GEO 权重计算未完成，请重新读取'
          : envelope?.taskStatus === 'ready'
            ? '暂无权重'
            : '正在读取 GEO 权重';
  const displayAsOf = current?.asOf || envelope?.requestedAsOf || asOf;
  const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: timezone }).format(
    readAt,
  );
  const shortDate = displayAsOf?.startsWith(`${year}-`)
    ? displayAsOf.slice(5).replace('-', '/')
    : displayAsOf?.replaceAll('-', '/');
  return (
    <section
      className={`card fade-in d1 ${styles.summary}`}
      data-geo-weight
      aria-label={i18n.text('GEO 权重')}
      aria-busy={summary.isFetching}
    >
      <div className={styles.heading}>
        <p className={styles.title} data-liekan-metric-label>
          {i18n.text('GEO 权重')} <span className={styles.badge}>Beta</span>
        </p>
        <button
          className={styles.evidenceButton}
          type="button"
          aria-label={i18n.text('查看 GEO 权重计算依据')}
          disabled={restricted || invalidated || !envelope}
          onClick={() => {
            setPinned(envelope);
            setOpen(true);
          }}
        >
          {i18n.text('计算依据')}
        </button>
      </div>
      <div className={styles.readout} role="status">
        {restricted ? (
          <p>{i18n.text('访问权限已变更，请重新打开页面')}</p>
        ) : current ? (
          <strong className={`num text-[24px] ${styles.score}`}>
            {current.level === null ? i18n.text('暂无权重') : num(current.level)}
          </strong>
        ) : (
          <span className={styles.statusValue}>{i18n.text(statusText)}</span>
        )}
      </div>
      {!restricted && (
        <p className={styles.metadata}>
          {current && (
            <span>
              <span>{i18n.text(geoPointStateLabel(current))}</span>
              {current.level !== null && (
                <>
                  {' '}
                  · <span>{i18n.text('最高 10')}</span>
                </>
              )}
            </span>
          )}{' '}
          {displayAsOf && (
            <time
              dateTime={displayAsOf}
              title={`${i18n.text('截至 {v0} 的 30 个完整自然日', [displayAsOf])} · ${timezone}`}
              aria-label={i18n.text('截至 {v0} 的 30 个完整自然日', [displayAsOf])}
            >
              {i18n.text('截至 {v0}', [shortDate])}
            </time>
          )}
        </p>
      )}
      {!restricted &&
        current &&
        (envelope?.stale || active || updateFailed || capacityBlocked || readFailed) && (
          <p className={styles.warning}>
            {envelope?.stale && i18n.text('上次结果')}
            {envelope?.stale && (active || updateFailed || capacityBlocked || readFailed) && ' · '}
            {active || updateFailed || capacityBlocked
              ? i18n.text(statusText)
              : readFailed
                ? i18n.text('当前读取未完成，保留上次计算结果')
                : ''}
          </p>
        )}
      {!restricted && envelope?.nextRetryAt && (
        <span className={styles.retryTime}>
          {i18n.text('下次可重试时间：{v0}', [time(envelope.nextRetryAt)])}
        </span>
      )}
      {!restricted && summary.pollExpired && active && (
        <span className={styles.caption}>{i18n.text('后台仍在处理，可稍后重新读取')}</span>
      )}
      {(summary.isError || invalidated || updateFailed || capacityBlocked || summary.pollExpired) &&
        !restricted && (
          <button
            className={styles.retryButton}
            type="button"
            disabled={summary.isFetching}
            onClick={reload}
          >
            {i18n.text('重新读取')}
          </button>
        )}
      {open && !restricted && (
        <GeoWeightDetails
          data={dialogData}
          snapshot={
            detailEnvelope && {
              ...detailEnvelope,
              taskStatus: envelope?.taskStatus || detailEnvelope.taskStatus,
              nextRetryAt: envelope?.nextRetryAt || null,
              errorCode: envelope?.errorCode || null,
            }
          }
          newerSnapshot={newerSnapshot}
          error={
            invalidated || mismatch
              ? detail.error ||
                summary.error ||
                new Error(i18n.text('GEO 权重计算未完成，请重新读取'))
              : detail.error
          }
          loading={detail.isFetching || (checkingPin && !detail.isError)}
          stale={readFailed || detail.isError || invalidated}
          canRecalculate={!!envelope?.canRecalculate && !invalidated && !readFailed}
          recalculating={recalculating || active}
          cooldownUntil={cooldownUntil}
          recalculateError={recalculateError}
          onRecalculate={recalculate}
          onClose={() => {
            setOpen(false);
            setPinned(null);
          }}
          onReload={reload}
          onExportConflict={status => setBlocked({ status, summaryAt: summary.dataUpdatedAt })}
        />
      )}
    </section>
  );
}
