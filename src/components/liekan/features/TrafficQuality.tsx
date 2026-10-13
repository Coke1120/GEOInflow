'use client';
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
  const dialog = useDialog();
  return (
    <Button disabled={disabled} onClick={() => dialog?.requestClose()}>
      关闭
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
      title="浏览流量质量"
      subtitle="查看统计口径、采集诊断与行为观察。"
      onClose={onClose}
      size="wide"
    >
      <p className="muted">
        {date(range.startAt)} 至 {date(range.endAt)} · {range.timezone}。本页读取随手动刷新更新。
      </p>
      <QueryState query={audit}>
        {data?.available === false ? (
          <Notice>{data.reason}</Notice>
        ) : (
          data?.available && (
            <>
              <Panel
                title="统计口径"
                subtitle="UV 沿用 Umami 匿名标识规则，同一人的网络或浏览器变化可能产生多个标识。"
              >
                <Body>
                  <div className="form-grid">
                    <Select
                      label="质量分类"
                      disabled={busy}
                      value={classification}
                      onChange={e => setClassification(e.target.value)}
                      options={[
                        ['', '全部分类'],
                        ...['browser', 'automated', 'suspected', 'unknown'].map(
                          v => [v, labels[v]] as [string, string],
                        ),
                      ]}
                    />
                    <Select
                      label="采集来源"
                      disabled={busy}
                      value={source}
                      onChange={e => setSource(e.target.value)}
                      options={[
                        ['', '全部来源'],
                        ['browser', '公共浏览器'],
                        ['authenticated_server', '授权服务端'],
                        ['legacy_override', '兼容覆盖字段'],
                      ]}
                    />
                    <Select
                      label="报告主机"
                      disabled={busy}
                      value={hostname}
                      onChange={e => setHostname(e.target.value)}
                      options={[
                        ['', '全部主机'],
                        ...(data.domainAudit?.hosts || [])
                          .filter(h => h.hostname)
                          .map(h => [h.hostname!, h.hostname!] as [string, string]),
                      ]}
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
                    排除 UV 表示没有任何纳入浏览事件的匿名标识；不同分类的 UV 存在交集。历史缺失判定
                    PV：{totals?.missingVerdictPV ?? '未读取'}。
                  </p>
                  <p className="muted">
                    日志“今日总请求”包括内容请求中的机器人、API、探测与失败请求。浏览 PV、UV
                    使用当前所选范围；各指标具有独立来源和单位。
                  </p>
                </Body>
              </Panel>
              <Panel
                title="统计策略"
                subtitle={`当前规则 ${data.policy?.ruleVersion} · 策略版本 ${data.policy?.revision}`}
              >
                <Body>
                  {!canManage && (
                    <Notice>当前权限可查看质量信息，策略修改需要网站管理权限。</Notice>
                  )}
                  {draft && (
                    <form data-unsaved={dirty} aria-busy={busy} onSubmit={e => e.preventDefault()}>
                      <Select
                        label="统计模式"
                        options={modes}
                        value={draft.mode}
                        disabled={!canManage || busy}
                        onChange={e =>
                          setDraft({ ...draft, mode: e.target.value as TrafficPolicy['mode'] })
                        }
                      />
                      <Textarea
                        label="允许主机"
                        value={hosts}
                        disabled={!canManage || busy}
                        onChange={e => setHosts(e.target.value)}
                        help="每行一个精确主机名；留空仅审计。主机声明用于统计管理，原始模式保留完整回看。"
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
                          预览影响
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
                          确认保存
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setDraft({ ...data.policy! });
                            setHosts(data.policy!.allowedHostnames.join('\n'));
                            setPreview(null);
                          }}
                        >
                          载入当前配置
                        </Button>
                      </div>
                    </form>
                  )}
                  {preview && (
                    <Notice>
                      按预览时数据：有效 PV {preview.current.includedPV} →{' '}
                      {preview.preview.includedPV}；有效 UV {preview.current.includedUV} →{' '}
                      {preview.preview.includedUV}。保存后，新到数据按相同策略计算。
                    </Notice>
                  )}
                  {message && <p role="status">{message}</p>}
                </Body>
                <Table
                  columns={['修改时间', '操作人', '版本', '操作']}
                  rows={(data.history || []).map(h => [
                    date(h.createdAt),
                    h.actorId,
                    `${h.before.revision} → ${h.after.revision}`,
                    <Button
                      key={h.id}
                      disabled={!canManage || busy}
                      onClick={() => {
                        setDraft({ ...h.before, revision: data.policy!.revision });
                        setHosts(h.before.allowedHostnames.join('\n'));
                        setPreview(null);
                      }}
                    >
                      预览恢复前配置
                    </Button>,
                  ])}
                  empty="尚无策略修改记录"
                />
              </Panel>
              <Panel
                title="采集诊断"
                subtitle="成功提交的 PostgreSQL 事件和性能采集请求，按服务端接收分钟统计。"
              >
                <Body>
                  <p className="muted">
                    诊断起点：
                    {data.diagnostics?.startedAt ? date(data.diagnostics.startedAt) : '尚未采集'}
                    。保留最近 30 天。桶范围：
                    {data.diagnostics
                      ? `${date(data.diagnostics.bucketStartAt)} 至 ${date(data.diagnostics.bucketEndAt)}`
                      : '未读取'}
                    。
                  </p>
                </Body>
                {data.diagnostics?.coverage === 'partial' && (
                  <Body>
                    <Notice>
                      仅覆盖部分范围，以下为已观测部分的计数与比例：
                      {date(data.diagnostics.observedFrom!)} 至{' '}
                      {date(data.diagnostics.observedUntil!)}。
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
                  empty="所选范围缺少诊断证据；历史请求和失败请求不在分母内"
                />
              </Panel>
              <Panel
                title="行为风险观察"
                subtitle="默认只观察；当前统计模式及 PV、UV 保持原有过滤规则。"
              >
                <QueryState query={risk}>
                  {risk.data?.available === false ? (
                    <Body>
                      <Notice>{risk.data.reason}</Notice>
                    </Body>
                  ) : (
                    risk.data?.available && (
                      <>
                        <Body>
                          {risk.data.state?.errorCode && (
                            <Notice tone="red">
                              后台分析暂不可用，系统将重试；当前显示已完成的观察。
                            </Notice>
                          )}
                          <p className="muted">
                            规则 {risk.data.ruleVersion} · 最近计算：
                            {risk.data.state?.computedAt
                              ? date(risk.data.state.computedAt)
                              : '等待后台计算'}
                            。窗口按服务端接收时间计算，延后两分钟确认，证据保留 30 天。
                          </p>
                          <p className="muted">
                            已计算窗口 {risk.data.coverage?.windows ?? 0}；部分覆盖窗口{' '}
                            {risk.data.coverage?.partialWindows ?? 0}
                            。未计算和超出保留期的窗口证据未知。
                          </p>
                          <p className="muted">
                            对当前策略纳入事件的影响预览：命中 PV{' '}
                            {risk.data.impact?.flaggedPV ?? '未读取'}，完全排除 UV{' '}
                            {risk.data.impact?.fullyExcludedUV ?? '未读取'}
                            。该预览使用事件时间范围，重叠观察窗口按事件去重。
                          </p>
                          <p className="muted">
                            明细按当前筛选限定访问，特征值保留完整观察窗口。网络集中补发、自动刷新及共享匿名标识可能形成异常线索，需要结合明细核查。
                          </p>
                        </Body>
                        <Table
                          columns={['观察窗口结束', '访问标识', '原因', '窗口 PV']}
                          numeric={[3]}
                          rows={(risk.data.findings || []).map(f => [
                            date(f.windowEnd),
                            f.visitId.slice(0, 8),
                            f.reasons.map(r => labels[r] || r).join('、'),
                            f.features.pageviews,
                          ])}
                          empty={
                            risk.data.coverage?.windows
                              ? '已计算窗口内暂无建议核查记录'
                              : '当前范围尚无已计算窗口'
                          }
                        />
                      </>
                    )
                  )}
                </QueryState>
              </Panel>
              <Panel title="质量明细" subtitle="按时间与事件标识稳定分页，每页最多 100 条。">
                <Table
                  columns={['时间', '路径', '分类', '采集来源', '原因', '纳入']}
                  rows={(data.rows || []).map(r => [
                    date(r.createdAt),
                    r.path || '未提供',
                    labels[r.classification] || r.classification,
                    labels[r.source === 'browser' ? 'browserSource' : r.source || ''] || '历史未知',
                    r.reasons.join('、') || '无额外证据',
                    r.included ? '是' : '否',
                  ])}
                />
                <Body>
                  <div className="form-actions">
                    <Button
                      disabled={!cursors.length || busy || audit.isFetching}
                      onClick={() => setCursors(cursors.slice(0, -1))}
                    >
                      上一页
                    </Button>
                    <Button
                      disabled={!data.nextCursor || busy || audit.isFetching}
                      onClick={() => setCursors([...cursors, data.nextCursor!])}
                    >
                      下一页
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
          刷新质量信息
        </Button>
        <QualityClose disabled={busy} />
      </DialogActions>
    </LiekanDialog>
  );
}
