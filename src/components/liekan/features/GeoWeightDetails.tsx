'use client';
import { useEffect, useRef, useState } from 'react';
import { GEO_ACTIVITY_FORMULA, GEO_LEVEL_MINIMUMS } from '@/lib/liekan/geo-weight/policy';
import type {
  GeoWeightResponse,
  GeoWeightSnapshotResponse,
} from '@/lib/liekan/contracts/geo-weight';
import {
  geoPurposeLabels,
  geoPointStateLabel,
  geoReasonLabels,
  geoExclusionLabels,
} from '@/lib/liekan/contracts/geo-weight-labels';
import { downloadGeoWeight } from '@/lib/liekan/contracts/geo-weight-client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { downloadFile } from '../data';
import { LiekanDialog, Button, Notice } from './ui';
import { featureNavigationHref } from './routes';
import Link from '../Link';
import styles from '@/styles/liekan/GeoWeight.module.css';
import { formLabels } from './crawlerRegistryUi';

export function GeoWeightDetails({
  data,
  snapshot,
  error,
  loading,
  stale,
  newerSnapshot = false,
  onClose,
  onReload,
  onExportConflict,
  canRecalculate = false,
  recalculating = false,
  cooldownUntil = 0,
  recalculateError = '',
  onRecalculate,
}: {
  data?: GeoWeightResponse;
  snapshot?: GeoWeightSnapshotResponse;
  canRecalculate?: boolean;
  recalculating?: boolean;
  cooldownUntil?: number;
  recalculateError?: string;
  onRecalculate?: () => Promise<void>;
  error?: unknown;
  loading: boolean;
  stale: boolean;
  newerSnapshot?: boolean;
  onClose: () => void;
  onReload: () => Promise<void>;
  onExportConflict: (status: number) => void;
}) {
  const i18n = useLiekanI18n();
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController>(null);
  useEffect(() => {
    setExporting(false);
    return () => controller.current?.abort();
  }, [data?.snapshotId]);
  const num = (v: number | null, digits = 0) =>
    v === null
      ? i18n.text('暂无权重')
      : v.toLocaleString(i18n.locale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
  async function exportCsv() {
    if (!data?.snapshotId || data.view !== 'detail' || loading || stale || error) return;
    const captured = data;
    const locale = i18n.locale;
    const owned = new AbortController();
    controller.current?.abort();
    controller.current = owned;
    setExporting(true);
    setMessage('');
    try {
      const result = await downloadGeoWeight(captured, locale, owned.signal);
      if (!owned.signal.aborted)
        downloadFile(
          result.csv,
          `liekan-geo-weight-${captured.current.asOf}.csv`,
          'text/csv;charset=utf-8',
        );
    } catch (e: any) {
      if (!owned.signal.aborted) {
        setMessage(e.message || '导出失败');
        if ([401, 403, 404, 409, 410].includes(e.status)) {
          onExportConflict(e.status);
          await onReload();
        }
      }
    } finally {
      if (!owned.signal.aborted) setExporting(false);
    }
  }
  const current = data?.current;
  const href = (page: string) =>
    featureNavigationHref(
      { page: 'geo-ai', websiteId: data.websiteId },
      { date: `range:${current.startAt}:${current.endAt - 1}` },
      page,
    );
  return (
    <LiekanDialog
      title={i18n.text('GEO 权重详情')}
      subtitle={i18n.text('AI 抓取版 · Beta')}
      onClose={onClose}
      size="wide"
    >
      <div className={styles.details}>
        {newerSnapshot && <Notice>{i18n.text('已有新日快照，重新读取可查看最新结果')}</Notice>}
        {(loading || ['queued', 'running'].includes(snapshot?.taskStatus)) && (
          <Notice>
            {i18n.text(
              loading && data
                ? '正在读取历史与详细依据，当前权重已显示'
                : snapshot?.stale
                  ? '正在更新今日权重'
                  : '正在计算 GEO 权重',
            )}
          </Notice>
        )}
        {!data && !loading && !error && !['queued', 'running'].includes(snapshot?.taskStatus) && (
          <Notice>{i18n.text('暂无权重')}</Notice>
        )}
        {snapshot?.taskStatus === 'failed' && (
          <Notice tone="amber">{i18n.text('GEO 权重更新失败，请重新读取')}</Notice>
        )}
        {snapshot?.taskStatus === 'capacity_blocked' && (
          <Notice tone="amber">{i18n.text('快照存储已满，请稍后重新读取')}</Notice>
        )}
        {snapshot?.stale && data && (
          <Notice tone="amber">{i18n.text('显示截至 {v0} 的上次权重', [data.current.asOf])}</Notice>
        )}
        {snapshot?.nextRetryAt && (
          <Notice>
            {i18n.text('下次可重试时间：{v0}', [
              new Date(snapshot.nextRetryAt).toLocaleString(i18n.locale, {
                timeZone: data?.timezone || 'UTC',
              }),
            ])}
          </Notice>
        )}
        {!!error && (
          <Notice tone="red">
            {i18n.system((error as Error).message || 'GEO 权重计算未完成，请重新读取')}
          </Notice>
        )}
        {recalculateError && <Notice tone="amber">{i18n.system(recalculateError)}</Notice>}
        {message && <Notice tone="amber">{i18n.system(message)}</Notice>}
        {stale && data && (
          <Notice tone="amber">{i18n.text('当前读取未完成，保留上次计算结果')}</Notice>
        )}
        <div className={styles.actions}>
          <Button disabled={loading || exporting} onClick={onReload}>
            {i18n.text('重新读取')}
          </Button>
          <Button
            disabled={
              !data?.snapshotId ||
              data.view !== 'detail' ||
              loading ||
              stale ||
              exporting ||
              !!error
            }
            onClick={exportCsv}
          >
            {i18n.text(exporting ? '正在导出' : '导出计算依据')}
          </Button>
          {canRecalculate && (
            <Button
              disabled={loading || recalculating || !!cooldownUntil || exporting}
              onClick={onRecalculate}
            >
              {i18n.text(recalculating ? '正在重新计算' : '重新计算 GEO 权重')}
            </Button>
          )}
        </div>
        {canRecalculate && (
          <p className={styles.caption}>
            {i18n.text('重新计算会更新此网站的日快照，5 分钟内可操作一次。')}
          </p>
        )}
        {canRecalculate && cooldownUntil > 0 && (
          <p className={styles.caption}>
            {i18n.text('可于 {v0} 重新计算', [
              new Date(cooldownUntil).toLocaleString(i18n.locale, {
                timeZone: data?.timezone || 'UTC',
              }),
            ])}
          </p>
        )}
        {data && (
          <>
            <section className={styles.section}>
              <h3>
                {i18n.text('GEO 权重')} {num(current.level)} ·{' '}
                {i18n.text(geoPointStateLabel(current))}
              </h3>
              <p>
                {i18n.text('截至 {v0} 的 30 个完整自然日', [current.asOf])} · {data.timezone} ·{' '}
                {data.hostname}
              </p>
              <p>
                {current.level === null ? i18n.text('证据积累期间暂不评级') : i18n.text('最高 10')}
                {current.level !== null &&
                  (current.level >= 10
                    ? ` · ${i18n.text('已达最高等级')}`
                    : ` · ${i18n.text('距权重 {v0} 还差 {v1} 加权单元', [current.level + 1, num(GEO_LEVEL_MINIMUMS[current.level] - current.weightedUnits)])}`)}
              </p>
              <p>{i18n.text('当前加权活动量：{v0}', [num(current.weightedUnits)])}</p>
              <p className={styles.caption}>
                {i18n.text('抓取反映内容取用活动；实际引用、训练采用与获客效果需要独立证据。')}
              </p>
              {current.reasons.length > 0 && (
                <Notice tone="amber">
                  {current.reasons.map(r => i18n.text(geoReasonLabels[r])).join(' · ')}
                </Notice>
              )}
            </section>
            <section className={styles.section}>
              <h3>{i18n.text('三类用途贡献')}</h3>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {[
                        '用途',
                        '计入系数',
                        '内容路径 P',
                        '有效单元 E',
                        '活跃日 D',
                        '合格运营方 B',
                        '加权单元',
                      ].map(label => (
                        <th key={label}>{i18n.text(label)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.categories.map(c => (
                      <tr key={c.purpose}>
                        <th>{i18n.text(geoPurposeLabels[c.purpose])}</th>
                        <td>×{num(c.coefficient)}</td>
                        <td>{num(c.paths)}</td>
                        <td>{num(c.units)}</td>
                        <td>{num(c.days)}</td>
                        <td>{num(c.operators)}</td>
                        <td>{num(c.weightedUnits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.caption}>{i18n.text('计分范围：固定 18 个已核验身份')}</p>
              <p className={styles.caption}>
                {i18n.text(
                  '同一用途、运营方、内容路径和自然日只计一个有效单元。200 与 304 联合去重。',
                )}
              </p>
              <p className={styles.caption}>
                {i18n.text(
                  '加权活动量为各类有效单元乘以系数后的整数之和。路径、活跃日和运营方数量用于解释数据。',
                )}
              </p>
              <p>{i18n.text('总观察请求：{v0}', [num(current.requests)])}</p>
              <p>
                {i18n.text('有效请求 {v0} · GET 200 {v1} · GET 304 {v2}', [
                  num(current.accepted),
                  num(current.status200),
                  num(current.status304),
                ])}
              </p>
              <p>
                {i18n.text('响应类型确认 {v0} · 按路径判断 {v1}', [
                  num(current.mimeConfirmed),
                  num(current.pathInferred),
                ])}
              </p>
              <details>
                <summary>{i18n.text('运营方资格与排除原因')}</summary>
                <p>
                  {i18n.text('同类运营方至少贡献 10 个有效单元，分布在至少 3 个自然日，才计入 B。')}
                </p>
                <ul>
                  {current.operators.map(o => (
                    <li key={`${o.purpose}:${o.platformId}`}>
                      {data.scope.find(s => s.platformId === o.platformId)?.platform ||
                        o.platformId}{' '}
                      · {i18n.text(geoPurposeLabels[o.purpose])} ·{' '}
                      {i18n.text('{v0} 个单元 / {v1} 日', [num(o.units), num(o.days)])}
                    </li>
                  ))}
                </ul>
                <dl className={styles.definition}>
                  {Object.entries(current.exclusions).map(([reason, count]) => (
                    <div key={reason}>
                      <dt>{i18n.text(geoExclusionLabels[reason])}</dt>
                      <dd>{num(count)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </section>
            {data.view === 'detail' && (
              <section className={styles.section}>
                <h3>{i18n.text('历史观察与前期比较')}</h3>
                <p>
                  {data.comparison?.comparable
                    ? i18n.text('较前期变化 {v0} 级', [num(data.comparison.delta)])
                    : i18n.text('观察条件未对齐，暂不显示确定升降')}
                </p>
                <p>
                  {i18n.text('前期权重')}：{num(data.previous?.level ?? null)}
                </p>
                <svg
                  className={styles.chart}
                  viewBox="0 0 560 160"
                  role="img"
                  aria-label={i18n.text('五个 30 日滚动观察点')}
                >
                  {[0, 5, 10].map(v => (
                    <g key={v}>
                      <line x1="35" y1={130 - v * 10} x2="535" y2={130 - v * 10} stroke="#e9ecf1" />
                      <text x="5" y={134 - v * 10}>
                        {v}
                      </text>
                    </g>
                  ))}
                  {(data.observations || []).map((p, index, all) => (
                    <g key={p.asOf}>
                      {p.connectPrevious && index > 0 && (
                        <line
                          x1={45 + (index - 1) * 120}
                          y1={130 - all[index - 1].level * 10}
                          x2={45 + index * 120}
                          y2={130 - p.level * 10}
                          stroke="#0f62fe"
                          strokeWidth="2"
                        />
                      )}
                      {p.level !== null && (
                        <circle cx={45 + index * 120} cy={130 - p.level * 10} r="4" fill="#0f62fe">
                          <title>
                            {p.asOf}: {num(p.level)}
                          </title>
                        </circle>
                      )}
                      <text x={45 + index * 120} y="155" textAnchor="middle">
                        {p.asOf.slice(5)}
                      </text>
                    </g>
                  ))}
                </svg>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{i18n.text('截止日期')}</th>
                        <th>{i18n.text('GEO 权重')}</th>
                        <th>{i18n.text('证据状态')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.observations?.map(p => (
                        <tr key={p.asOf}>
                          <th>{p.asOf}</th>
                          <td>{num(p.level)}</td>
                          <td>{i18n.text(geoPointStateLabel(p))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            <section className={styles.section}>
              <h3>{i18n.text('计分范围与统一目录')}</h3>
              <p>
                {i18n.text('规则纳入 18 个身份、8 家运营方；本窗口有效计分 {v0} 个身份。', [
                  current.identities.filter(i => i.accepted > 0).length,
                ])}
              </p>
              <p>
                {i18n.text('当前目录：{v0} 个平台、{v1} 个产品、{v2} 个身份。', [
                  data.directoryCounts.platforms,
                  data.directoryCounts.products,
                  data.directoryCounts.identities,
                ])}
              </p>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {['身份', '运营方', '用途', '核验请求', '有效请求', '官方资料'].map(t => (
                        <th key={t}>{i18n.text(t)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.scope.map(s => {
                      const observed = current.identities.find(i => i.id === s.id);
                      return (
                        <tr key={s.id}>
                          <th>
                            {s.name}
                            <br />
                            <span className={styles.caption}>
                              {i18n.text(formLabels[s.productForm] || formLabels.unknown)}
                            </span>
                          </th>
                          <td>{s.platform}</td>
                          <td>{i18n.text(geoPurposeLabels[s.purpose])}</td>
                          <td>{observed ? num(observed.verified) : i18n.text('未观察到')}</td>
                          <td>{observed ? num(observed.accepted) : i18n.text('未观察到')}</td>
                          <td>
                            {s.documentation && (
                              <a href={s.documentation} target="_blank" rel="noopener noreferrer">
                                {i18n.text('查看资料')}
                              </a>
                            )}
                            <br />
                            {s.reviewedAt}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>{i18n.text('观察身份的排除明细')}</summary>
                <ul>
                  {current.identities
                    .filter(identity => Object.keys(identity.exclusions).length > 0)
                    .map(identity => (
                      <li key={identity.id}>
                        {data.scope.find(s => s.id === identity.id)?.name || identity.id} ·{' '}
                        {Object.entries(identity.exclusions)
                          .map(
                            ([reason, count]) =>
                              `${i18n.text(geoExclusionLabels[reason])} ${num(count)}`,
                          )
                          .join(' · ')}
                      </li>
                    ))}
                </ul>
              </details>
              <p>{i18n.text('新增目录身份不会自动扩大评分范围；历史记录按采集时版本复算。')}</p>
              <h3>{i18n.text('工作台与个人 Agent 观察')}</h3>
              <p>{i18n.text('产品形态与用途存在交集，这些观察不再增加权重。')}</p>
              {['workbench', 'personal_agent'].map(form => (
                <p key={form}>
                  {i18n.text(form === 'workbench' ? 'AI 工作台' : '个人 Agent')}：
                  {current.forms.some(f => f.form === form)
                    ? num(current.forms.find(f => f.form === form).requests)
                    : i18n.text('当前范围缺少可独立归因的请求')}
                </p>
              ))}
              <p>
                {i18n.text(
                  'ChatGPT Agent 用途未确认；Manus、Muse 和 Exa 的资料登记不代表本次请求已经通过计分核验。',
                )}
              </p>
              <div className={styles.actions}>
                <Link href={href('geo-bots')}>{i18n.text('查看 AI 爬虫分析')}</Link>
                <Link href={href('geo-ai-pages')}>{i18n.text('查看抓取页面')}</Link>
                {data.canManageCatalog && (
                  <Link href={href('crawlers-manage')}>{i18n.text('管理爬虫库')}</Link>
                )}
              </div>
              <p className={styles.caption}>
                {i18n.text('关联分析页包含更广的观察范围，数量可能与计分请求不同。')}
              </p>
            </section>
            <details className={styles.section}>
              <summary>{i18n.text('公式、版本与计算时间')}</summary>
              <code>{GEO_ACTIVITY_FORMULA}</code>
              <p>
                {i18n.text('搜索、用户触发、训练的有效单元分别乘以 10、7、3，按下表取整数权重。')}
              </p>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{i18n.text('GEO 权重')}</th>
                      <th>{i18n.text('加权活动量区间')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GEO_LEVEL_MINIMUMS.map((minimum, index) => (
                      <tr key={minimum}>
                        <th>{index + 1}</th>
                        <td>
                          {index === 9
                            ? `≥ ${num(minimum)}`
                            : `${num(minimum)} – ${num(GEO_LEVEL_MINIMUMS[index + 1] - 1)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>{i18n.text('完整观测且有效活动量为零时显示 0；缺少证据或积累不足时暂不评级。')}</p>
              <p>{i18n.text('区间用于近似评估，等级越高门槛越高；Beta 阈值尚未进行行业校准。')}</p>
              <dl className={styles.definition}>
                {[
                  ['算法版本', data.algorithm],
                  ['评分范围摘要', data.scoreScopeHash],
                  ['读取目录版本', data.readCatalogVersion],
                  ['事件目录版本', current.catalogVersions.join(', ') || i18n.text('缺失')],
                  [
                    '计算时间',
                    new Date(data.calculatedAt).toLocaleString(i18n.locale, {
                      timeZone: data.timezone,
                    }),
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{i18n.text(k)}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        )}
      </div>
    </LiekanDialog>
  );
}
