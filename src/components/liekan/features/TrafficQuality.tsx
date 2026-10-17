'use client';
import { TrafficEvidencePanel } from './TrafficEvidencePanel';
import { TableCell } from './ui';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { useEffect, useState } from 'react';
import type {
  TrafficAudit,
  TrafficPreview,
  TrafficPolicy,
  BrowserRiskReport,
} from '@/lib/liekan/contracts/traffic-quality';
import { useDialog } from './LiekanDialog';
import { useData, useFeature } from './context';
import {
  Body,
  Button,
  DialogActions,
  LiekanDialog,
  Notice,
  Panel,
  QueryState,
  Select,
  Table,
  Textarea,
} from './ui';

const labels: Record<string, string> = {
  browser: '浏览器相容',
  automated: '已知自动化',
  suspected: '来源可疑',
  unknown: '证据未知',
  browserSource: '公共浏览器',
  authenticated_server: '授权服务端',
  legacy_override: '兼容覆盖字段',
  'sustained-frequency': '持续高频',
  'regular-timing': '机械节律',
  'repeated-path': '路径高度重复',
};
const modes: [string, string][] = [
  ['standard', '标准：排除已知自动化'],
  ['strict', '严格：额外排除来源可疑'],
  ['raw', '原始：查看全部事件'],
];
function QualityClose({ disabled }: { disabled: boolean }) {
  const i18n = useLiekanI18n();
  const dialog = useDialog();
  return (
    <Button disabled={disabled} onClick={() => dialog?.requestClose()}>
      {i18n.text('关闭')}
    </Button>
  );
}
const percent = (v: number | null | undefined) =>
  v == null ? '未采集' : `${(v * 100).toFixed(1)}%`;
export function TrafficQuality({
  canManage,
  onClose,
}: {
  canManage: boolean;
  onClose: () => void;
}) {
  const i18n = useLiekanI18n();
  const [showObservations, setShowObservations] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const c = useFeature();
  const [classification, setClassification] = useState(''),
    [source, setSource] = useState(''),
    [hostname, setHostname] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [draft, setDraft] = useState<(TrafficPolicy & { revision: string }) | null>(null);
  const [hosts, setHosts] = useState(''),
    [preview, setPreview] = useState<TrafficPreview | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const endpoint = `/liekan/websites/${c.siteId}/traffic-quality`;
  const range = { startAt: c.range.startAt, endAt: c.range.endAt, timezone: c.range.timezone };
  const scope = {
    ...range,
    classification: classification || undefined,
    source: source || undefined,
    hostname: hostname || undefined,
  };
  const audit = useData<TrafficAudit>(['traffic-quality', scope, cursors.at(-1)], signal =>
    c.api.get(endpoint, { ...scope, cursor: cursors.at(-1) }, signal),
  );
  const risk = useData<BrowserRiskReport>(['browser-risk', scope], signal =>
    c.api.get(`${endpoint}/risk`, scope, signal),
  );
  const data = audit.data;
  useEffect(() => {
    if (!draft && data?.policy) {
      setDraft({ ...data.policy });
      setHosts(data.policy.allowedHostnames.join('\n'));
    }
  }, [data?.policy, draft]);
  useEffect(() => {
    setPreview(null);
  }, [draft, hosts, classification, source, hostname, range.startAt, range.endAt, range.timezone]);
  useEffect(() => {
    setCursors([]);
  }, [classification, source, hostname, range.startAt, range.endAt, range.timezone]);
  const date = (value: string | number) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: range.timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  const policy = (): TrafficPolicy => ({
    mode: draft!.mode,
    allowedHostnames: hosts
      .split(/[\n,，]/)
      .map(v => v.trim())
      .filter(Boolean),
    expectedRevision: draft!.revision,
  });
  const operate = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e: any) {
      setMessage(e.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const totals = data?.totals;
  const dirty =
    !!draft &&
    (draft.mode !== data?.policy?.mode || hosts !== data?.policy?.allowedHostnames.join('\n'));
  return (
    <LiekanDialog
      title={i18n.text('浏览流量质量')}
      subtitle={i18n.text('查看统计口径、采集诊断与行为观察。')}
      onClose={onClose}
      size="wide"
    >
      <p className="muted">
        {date(range.startAt)}
        {i18n.fragment(' 至 ', true, true)}
        {date(range.endAt)} · {range.timezone}
        {i18n.fragment('。本页读取随手动刷新更新。', true, false)}
      </p>
      <details onToggle={event => setShowObservations(event.currentTarget.open)}>
        <summary>{i18n.text('观察证据')}</summary>
        {showObservations && (
          <TrafficEvidencePanel
            key={c.siteId}
            websiteId={c.siteId}
            hostname={String(c.site?.domain || '')}
            range={range}
            mode="observations"
          />
        )}
      </details>
      <details onToggle={event => setShowReconciliation(event.currentTarget.open)}>
        <summary>{i18n.text('采集对账')}</summary>
        {showReconciliation && (
          <TrafficEvidencePanel
            key={c.siteId}
            websiteId={c.siteId}
            hostname={String(c.site?.domain || '')}
            range={range}
            mode="reconciliation"
          />
        )}
      </details>
      <QueryState query={audit}>
        {data?.available === false ? (
          <Notice>{i18n.system(data.reason)}</Notice>
        ) : (
          data?.available && (
            <>
              <Panel
                title={i18n.text('统计口径')}
                subtitle={i18n.text(
                  'UV 沿用 Umami 匿名标识规则，同一人的网络或浏览器变化可能产生多个标识。',
                )}
              >
                <Body>
                  <div className="form-grid">
                    <Select
                      label={i18n.text('质量分类')}
                      disabled={busy}
                      value={classification}
                      onChange={e => setClassification(e.target.value)}
                      options={[
                        ['', i18n.text('全部分类')],
                        ...['browser', 'automated', 'suspected', 'unknown'].map(
                          v => [v, labels[v]] as [string, string],
                        ),
                      ]}
                      localizeLabels
                    />
                    <Select
                      label={i18n.text('采集来源')}
                      disabled={busy}
                      value={source}
                      onChange={e => setSource(e.target.value)}
                      options={[
                        ['', i18n.text('全部来源')],
                        ['browser', i18n.text('公共浏览器')],
                        ['authenticated_server', i18n.text('授权服务端')],
                        ['legacy_override', i18n.text('兼容覆盖字段')],
                      ]}
                      localizeLabels
                    />
                    <Select
                      label={i18n.text('报告主机')}
                      disabled={busy}
                      value={hostname}
                      onChange={e => setHostname(e.target.value)}
                      options={[
                        ['', i18n.text('全部主机')],
                        ...(data.domainAudit?.hosts || [])
                          .filter(h => h.hostname)
                          .map(h => [h.hostname!, h.hostname!] as [string, string]),
                      ]}
                      localizeLabels
                    />
                  </div>
                </Body>
                {totals && (
                  <Table
                    columns={['指标', '原始', '纳入', '排除']}
                    numeric={[1, 2, 3]}
                    rows={[
                      ['PV', totals.rawPV, totals.includedPV, totals.excludedPV],
                      ['UV', totals.rawUV, totals.includedUV, totals.fullyExcludedUV],
                    ]}
                  />
                )}
                <Body>
                  <p className="muted">
                    {i18n.fragment(
                      '排除 UV 表示没有任何纳入浏览事件的匿名标识；不同分类的 UV 存在交集。历史缺失判定 PV：',
                      false,
                      true,
                    )}
                    {totals?.missingVerdictPV ?? i18n.text('未读取')}。
                  </p>
                  <p className="muted">
                    {i18n.text(
                      '日志“今日总请求”包括内容请求中的机器人、API、探测与失败请求。浏览 PV、UV 使用当前所选范围；各指标具有独立来源和单位。',
                    )}
                  </p>
                </Body>
              </Panel>
              <Panel
                title={i18n.text('统计策略')}
                subtitle={i18n.text('当前规则 {v0} · 策略版本 {v1}', [
                  data.policy?.ruleVersion,
                  data.policy?.revision,
                ])}
              >
                <Body>
                  {!canManage && (
                    <Notice>
                      {i18n.text('当前权限可查看质量信息，策略修改需要网站管理权限。')}
                    </Notice>
                  )}
                  {draft && (
                    <form data-unsaved={dirty} aria-busy={busy} onSubmit={e => e.preventDefault()}>
                      <Select
                        label={i18n.text('统计模式')}
                        options={modes}
                        localizeLabels
                        value={draft.mode}
                        disabled={!canManage || busy}
                        onChange={e =>
                          setDraft({ ...draft, mode: e.target.value as TrafficPolicy['mode'] })
                        }
                      />
                      <Textarea
                        label={i18n.text('允许主机')}
                        value={hosts}
                        disabled={!canManage || busy}
                        onChange={e => setHosts(e.target.value)}
                        help={i18n.text(
                          '每行一个精确主机名；留空仅审计。主机声明用于统计管理，原始模式保留完整回看。',
                        )}
                      />
                      <div className="form-actions">
                        <Button
                          disabled={!canManage || busy}
                          onClick={() =>
                            operate(async () => {
                              setPreview(
                                await c.api.post<TrafficPreview>(`${endpoint}/preview`, {
                                  policy: policy(),
                                  range: scope,
                                }),
                              );
                            })
                          }
                        >
                          {i18n.text('预览影响')}
                        </Button>
                        <Button
                          primary
                          disabled={!canManage || busy || !preview}
                          onClick={() =>
                            operate(async () => {
                              const saved = await c.api.put(endpoint, policy());
                              setDraft(saved);
                              setHosts(saved.allowedHostnames.join('\n'));
                              setPreview(null);
                              setCursors([]);
                              await audit.refetch();
                              await risk.refetch();
                              await c.refresh();
                              setMessage('统计策略已保存');
                            })
                          }
                        >
                          {i18n.text('确认保存')}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setDraft({ ...data.policy! });
                            setHosts(data.policy!.allowedHostnames.join('\n'));
                            setPreview(null);
                          }}
                        >
                          {i18n.text('载入当前配置')}
                        </Button>
                      </div>
                    </form>
                  )}
                  {preview && (
                    <Notice>
                      {i18n.fragment('按预览时数据：有效 PV ', false, true)}
                      {preview.current.includedPV} → {preview.preview.includedPV}
                      {i18n.fragment('；有效 UV ', true, true)}
                      {preview.current.includedUV} → {preview.preview.includedUV}
                      {i18n.fragment('。保存后，新到数据按相同策略计算。', true, false)}
                    </Notice>
                  )}
                  {message && <p role="status">{i18n.system(message)}</p>}
                </Body>
                <Table
                  columns={['修改时间', '操作人', '版本', '操作']}
                  rows={(data.history || []).map(h => [
                    date(h.createdAt),
                    h.actorId,
                    `${h.before.revision} → ${h.after.revision}`,
                    <TableCell
                      sortValue={i18n.source('预览恢复前配置')}
                      searchValue={i18n.english.text('预览恢复前配置')}
                    >
                      <Button
                        key={h.id}
                        disabled={!canManage || busy}
                        onClick={() => {
                          setDraft({ ...h.before, revision: data.policy!.revision });
                          setHosts(h.before.allowedHostnames.join('\n'));
                          setPreview(null);
                        }}
                      >
                        {i18n.text('预览恢复前配置')}
                      </Button>
                    </TableCell>,
                  ])}
                  empty={i18n.text('尚无策略修改记录')}
                />
              </Panel>
              <Panel
                title={i18n.text('采集诊断')}
                subtitle={i18n.text(
                  '成功提交的 PostgreSQL 事件和性能采集请求，按服务端接收分钟统计。',
                )}
              >
                <Body>
                  <p className="muted">
                    {i18n.fragment('诊断起点：', false, true)}
                    {data.diagnostics?.startedAt
                      ? date(data.diagnostics.startedAt)
                      : i18n.text('尚未采集')}
                    {i18n.fragment('。保留最近 30 天。桶范围：', true, true)}
                    {data.diagnostics
                      ? i18n.text('{v0} 至 {v1}', [
                          date(data.diagnostics.bucketStartAt),
                          date(data.diagnostics.bucketEndAt),
                        ])
                      : i18n.text('未读取')}
                    。
                  </p>
                </Body>
                {data.diagnostics?.coverage === 'partial' && (
                  <Body>
                    <Notice>
                      {i18n.fragment('仅覆盖部分范围，以下为已观测部分的计数与比例：', false, true)}
                      {date(data.diagnostics.observedFrom!)}
                      {i18n.fragment(' 至', true, true)} {date(data.diagnostics.observedUntil!)}。
                    </Notice>
                  </Body>
                )}
                <Table
                  columns={['成功新增', '成功去重', 'UUID 覆盖率', '成功处理中的重复占比']}
                  numeric={[0, 1, 2, 3]}
                  rows={
                    data.diagnostics && data.diagnostics.coverage !== 'missing'
                      ? [
                          [
                            data.diagnostics.written,
                            data.diagnostics.duplicate,
                            percent(data.diagnostics.uuidCoverage),
                            percent(data.diagnostics.duplicateFraction),
                          ],
                        ]
                      : []
                  }
                  empty={i18n.text('所选范围缺少诊断证据；历史请求和失败请求不在分母内')}
                />
              </Panel>
              <Panel
                title={i18n.text('行为风险观察')}
                subtitle={i18n.text('默认只观察；当前统计模式及 PV、UV 保持原有过滤规则。')}
              >
                <QueryState query={risk}>
                  {risk.data?.available === false ? (
                    <Body>
                      <Notice>{i18n.system(risk.data.reason)}</Notice>
                    </Body>
                  ) : (
                    risk.data?.available && (
                      <>
                        <Body>
                          {risk.data.state?.errorCode && (
                            <Notice tone="red">
                              {i18n.text('后台分析暂不可用，系统将重试；当前显示已完成的观察。')}
                            </Notice>
                          )}
                          <p className="muted">
                            {i18n.fragment('规则 ', false, true)}
                            {risk.data.ruleVersion}
                            {i18n.fragment(' · 最近计算：', true, true)}
                            {risk.data.state?.computedAt
                              ? date(risk.data.state.computedAt)
                              : i18n.text('等待后台计算')}
                            {i18n.fragment(
                              '。窗口按服务端接收时间计算，延后两分钟确认，证据保留 30 天。',
                              true,
                              false,
                            )}
                          </p>
                          <p className="muted">
                            {i18n.fragment('已计算窗口 ', false, true)}
                            {risk.data.coverage?.windows ?? 0}
                            {i18n.fragment('；部分覆盖窗口', true, true)}{' '}
                            {risk.data.coverage?.partialWindows ?? 0}
                            {i18n.fragment('。未计算和超出保留期的窗口证据未知。', true, false)}
                          </p>
                          <p className="muted">
                            {i18n.fragment('对当前策略纳入事件的影响预览：命中 PV', false, true)}{' '}
                            {risk.data.impact?.flaggedPV ?? i18n.text('未读取')}
                            {i18n.fragment('，完全排除 UV', true, true)}{' '}
                            {risk.data.impact?.fullyExcludedUV ?? i18n.text('未读取')}
                            {i18n.fragment(
                              '。该预览使用事件时间范围，重叠观察窗口按事件去重。',
                              true,
                              false,
                            )}
                          </p>
                          <p className="muted">
                            {i18n.text(
                              '明细按当前筛选限定访问，特征值保留完整观察窗口。网络集中补发、自动刷新及共享匿名标识可能形成异常线索，需要结合明细核查。',
                            )}
                          </p>
                        </Body>
                        <Table
                          columns={['观察窗口结束', '访问标识', '原因', '窗口 PV']}
                          numeric={[3]}
                          rows={(risk.data.findings || []).map(f => [
                            date(f.windowEnd),
                            f.visitId.slice(0, 8),
                            <TableCell
                              sortValue={f.reasons
                                .map(r => {
                                  if (r === 'sustained-frequency')
                                    return i18n.source('持续高频（峰值 {v0} PV/分钟）', [
                                      f.features.peakMinute,
                                    ]);
                                  if (r === 'regular-timing')
                                    return i18n.source('机械节律（间隔 {v0} 秒，集中率 {v1}）', [
                                      (f.features.medianGapMs! / 1000).toFixed(1),
                                      percent(f.features.timingConcentration),
                                    ]);
                                  if (r === 'repeated-path')
                                    return i18n.source('路径高度重复（{v0}）', [
                                      percent(f.features.repeatFraction),
                                    ]);
                                  return labels[r] || r;
                                })
                                .join('、')}
                              searchValue={f.reasons
                                .map(r => {
                                  if (r === 'sustained-frequency')
                                    return i18n.english.text('持续高频（峰值 {v0} PV/分钟）', [
                                      f.features.peakMinute,
                                    ]);
                                  if (r === 'regular-timing')
                                    return i18n.english.text(
                                      '机械节律（间隔 {v0} 秒，集中率 {v1}）',
                                      [
                                        (f.features.medianGapMs! / 1000).toFixed(1),
                                        percent(f.features.timingConcentration),
                                      ],
                                    );
                                  if (r === 'repeated-path')
                                    return i18n.english.text('路径高度重复（{v0}）', [
                                      percent(f.features.repeatFraction),
                                    ]);
                                  return i18n.english.system(labels[r] || r);
                                })
                                .join('、')}
                            >
                              {f.reasons
                                .map(r => {
                                  if (r === 'sustained-frequency')
                                    return i18n.text('持续高频（峰值 {v0} PV/分钟）', [
                                      f.features.peakMinute,
                                    ]);
                                  if (r === 'regular-timing')
                                    return i18n.text('机械节律（间隔 {v0} 秒，集中率 {v1}）', [
                                      (f.features.medianGapMs! / 1000).toFixed(1),
                                      percent(f.features.timingConcentration),
                                    ]);
                                  if (r === 'repeated-path')
                                    return i18n.text('路径高度重复（{v0}）', [
                                      percent(f.features.repeatFraction),
                                    ]);
                                  return i18n.system(labels[r] || r);
                                })
                                .join('、')}
                            </TableCell>,
                            f.features.pageviews,
                          ])}
                          empty={
                            risk.data.coverage?.windows
                              ? i18n.text('已计算窗口内暂无建议核查记录')
                              : i18n.text('当前范围尚无已计算窗口')
                          }
                        />
                      </>
                    )
                  )}
                </QueryState>
              </Panel>
              <Panel
                title={i18n.text('质量明细')}
                subtitle={i18n.text('按时间与事件标识稳定分页，每页最多 100 条。')}
              >
                <Table
                  columns={['时间', '路径', '分类', '采集来源', '原因', '纳入']}
                  rows={(data.rows || []).map(r => [
                    date(r.createdAt),
                    <TableCell
                      sortValue={r.path || i18n.source('未提供')}
                      searchValue={r.path || i18n.english.text('未提供')}
                    >
                      {r.path || i18n.text('未提供')}
                    </TableCell>,
                    <TableCell
                      sortValue={labels[r.classification] || r.classification}
                      searchValue={i18n.english.system(
                        labels[r.classification] || r.classification,
                      )}
                    >
                      {i18n.system(labels[r.classification] || r.classification)}
                    </TableCell>,
                    <TableCell
                      sortValue={
                        labels[r.source === 'browser' ? 'browserSource' : r.source || ''] ||
                        i18n.source('历史未知')
                      }
                      searchValue={
                        i18n.english.system(
                          labels[r.source === 'browser' ? 'browserSource' : r.source || ''],
                        ) || i18n.english.text('历史未知')
                      }
                    >
                      {i18n.system(
                        labels[r.source === 'browser' ? 'browserSource' : r.source || ''],
                      ) || i18n.text('历史未知')}
                    </TableCell>,
                    <TableCell
                      sortValue={r.reasons.join('、') || i18n.source('无额外证据')}
                      searchValue={r.reasons.join('、') || i18n.english.text('无额外证据')}
                    >
                      {r.reasons.join('、') || i18n.text('无额外证据')}
                    </TableCell>,
                    <TableCell
                      sortValue={r.included ? i18n.source('是') : i18n.source('否')}
                      searchValue={r.included ? i18n.english.text('是') : i18n.english.text('否')}
                    >
                      {r.included ? i18n.text('是') : i18n.text('否')}
                    </TableCell>,
                  ])}
                />
                <Body>
                  <div className="form-actions">
                    <Button
                      disabled={!cursors.length || busy || audit.isFetching}
                      onClick={() => setCursors(cursors.slice(0, -1))}
                    >
                      {i18n.text('上一页')}
                    </Button>
                    <Button
                      disabled={!data.nextCursor || busy || audit.isFetching}
                      onClick={() => setCursors([...cursors, data.nextCursor!])}
                    >
                      {i18n.text('下一页')}
                    </Button>
                  </div>
                </Body>
              </Panel>
            </>
          )
        )}
      </QueryState>
      <DialogActions>
        <Button
          disabled={busy || audit.isFetching || risk.isFetching}
          onClick={async () => {
            setPreview(null);
            setCursors([]);
            await Promise.all([audit.refetch(), risk.refetch()]);
          }}
        >
          {i18n.text('刷新质量信息')}
        </Button>
        <QualityClose disabled={busy} />
      </DialogActions>
    </LiekanDialog>
  );
}
