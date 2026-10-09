'use client';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { CrawlerAnalysisResponse } from '@/lib/liekan/contracts/crawler-analysis';
import { featureRequest } from '@/lib/liekan/upstream/features-client';
import { crawlerPathSchema } from '@/lib/liekan/contracts/crawlers';
import { downloadFile } from '../data';
import { Badge, Button, Definition, LiekanDialog, Notice, Select, Table, Tabs } from './ui';
import { CrawlerPoliciesPanel } from './CrawlerPoliciesPanel';

const labels = {
  training: 'AI 训练',
  search: 'AI 搜索',
  user: '用户触发',
  traditional_search: '传统搜索',
};
const riskLabels = {
  access: '访问受阻',
  origin: '服务异常',
  surge: '抓取强度',
  coverage: '抓取覆盖',
  expected_access: '期望访问冲突',
  identity: '身份核验',
  sensitive_path: '敏感路径',
  observation: '观测质量',
  execution: '策略执行',
};
const confidenceLabels = { confirmed: '已证实', possible: '可能', insufficient: '证据不足' };
const gradeLabels = { high: '高', medium: '中', info: '提示' };
const evidenceLabels: Record<string, string> = {
  requests: '请求数',
  denied403429: '403 / 429',
  ratio: '比例',
  comparableWindows: '可比窗口数',
  median: '同期中位数',
  catalogPages: '共同目录页',
  baselineGets: '前期有效 GET',
  before: '前期覆盖页',
  after: '本期覆盖页',
  decline: '下降比例',
  ownedTerminatingBlocks: '本平台终止拦截',
  verifiedSearchDenied: '已核验搜索受阻',
  rangeMismatches: '范围不匹配',
  sensitivePathRequests: '敏感路径请求',
  originErrors: '源站错误',
  status5xx: '5xx',
  denied: '受阻请求',
  count: '次数',
};
const num = (value: number | null | undefined) =>
  value == null ? '待接入' : value.toLocaleString('zh-CN');
const date = (value: string | number | undefined, timezone: string) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value))
    : '尚未计算';

export function CrawlerDialog({
  websiteId,
  websiteName,
  botName,
  onClose,
  range,
  controlPanel,
}: {
  websiteId: string;
  websiteName?: string;
  botName?: string;
  onClose: () => void;
  range?: { startAt: number; endAt: number; timezone: string };
  controlPanel?: (permissions: CrawlerAnalysisResponse['permissions']) => ReactNode;
}) {
  const [data, setData] = useState<CrawlerAnalysisResponse | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  const [tab, setTab] = useState(botName ? 'detail' : 'risk'),
    [botId, setBotId] = useState(''),
    [critical, setCritical] = useState(''),
    [status, setStatus] = useState(''),
    [domain, setDomain] = useState<any>(null),
    [checks, setChecks] = useState<any[]>([]),
    [paths, setPaths] = useState('/'),
    [busy, setBusy] = useState(false),
    [fragment, setFragment] = useState(''),
    [criticalDirty, setCriticalDirty] = useState(false),
    [exportAction, setExportAction] = useState('block'),
    [exportMatch, setExportMatch] = useState<'exact' | 'prefix'>('exact'),
    [rate, setRate] = useState('10'),
    [burst, setBurst] = useState('20');
  const criticalDirtyRef = useRef(false);
  const base = `/liekan/websites/${websiteId}`;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    const now = Date.now(),
      requestedEnd = Math.min(range?.endAt || now, now),
      endAt = requestedEnd > now - 30000 ? Math.floor(requestedEnd / 30000) * 30000 : requestedEnd;
    const params = {
      startAt: Math.max(
        range?.startAt ? range.startAt - (requestedEnd - endAt) : endAt - 7 * 86400000,
        endAt - 90 * 86400000,
      ),
      endAt,
      timezone: range?.timezone || 'Asia/Shanghai',
    };
    featureRequest<CrawlerAnalysisResponse>('GET', `${base}/crawler-analysis`, params, abort.signal)
      .then(result => {
        if (abort.signal.aborted) return;
        setData(result);
        if (!criticalDirtyRef.current) setCritical(result.criticalPaths.join('\n'));
        setBotId(
          current =>
            current ||
            result.bots.find(bot => bot.name === botName && bot.botId)?.botId ||
            result.directory.find(bot => bot.name === botName)?.id ||
            result.directory[0].id,
        );
      })
      .catch(error => {
        if (!abort.signal.aborted) setError(error.message || '归因分析读取失败');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [websiteId, range?.startAt, range?.endAt, range?.timezone, version]);
  const reload = () => setVersion(value => value + 1);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try {
      await work();
    } catch (error: any) {
      setStatus(error.message || '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  async function diagnostics(signal?: AbortSignal) {
    const [current, history] = await Promise.all([
      featureRequest<any>('GET', `${base}/crawler-domain-verification`, undefined, signal),
      featureRequest<any[]>('GET', `${base}/crawler-checks`, undefined, signal),
    ]);
    if (signal?.aborted) return;
    setDomain(old => ({
      ...current,
      ...(old?.hostname === current.hostname && old?.expiresAt === current.expiresAt && old?.value
        ? { value: old.value }
        : {}),
    }));
    setChecks(history);
  }
  useEffect(() => {
    if (tab !== 'checks') return;
    const abort = new AbortController();
    let live = true;
    const read = () =>
      diagnostics(abort.signal).catch(error => {
        if (live) setStatus(error.message);
      });
    void read();
    const timer = setInterval(() => void read(), 10000);
    return () => {
      live = false;
      abort.abort();
      clearInterval(timer);
    };
  }, [tab, websiteId]);
  const bot = data?.directory.find(bot => bot.id === botId),
    metrics = data?.bots.filter(row => row.botId === botId) || [],
    pages = data?.pages.filter(row => row.botId === botId) || [],
    platform = data?.platforms.find(row => row.platformId === bot?.platformId);
  const sum = (field: string) => metrics.reduce((total, row) => total + Number(row[field] || 0), 0);
  const findings = data?.findings.filter(row => !botName || row.botId === botId) || [];
  const selectors = (match: 'exact' | 'prefix' = 'exact') =>
    paths
      .split('\n')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => crawlerPathSchema.parse({ value, match }));
  return (
    <LiekanDialog
      title={botName ? `${botName} · 归因与风险` : 'AI 蜘蛛归因与控制'}
      subtitle={websiteName}
      size="wide"
      onClose={onClose}
    >
      <Tabs
        active={tab}
        onChange={setTab}
        items={[
          ['detail', '蜘蛛详情'],
          ['risk', '风险证据'],
          ['checks', '公开页面检查'],
          ['control', '访问策略与导出'],
        ]}
      />
      {loading && <Notice>正在读取蜘蛛归因数据</Notice>}
      {error && (
        <Notice tone="red">
          {error}
          <Button onClick={reload}>重试读取</Button>
        </Notice>
      )}
      {status && <Notice>{status}</Notice>}
      {data && (
        <>
          {data.quality.state !== 'complete' && (
            <Notice tone="amber">
              采集覆盖
              {{
                partial: '存在已知缺口',
                unknown: '缺少连续性证据',
                missing: '当前范围缺少输入',
                unsupported: '当前来源暂不支持',
              }[data.quality.state] || '尚未确认完整'}
              。当前数字来自已接收日志，趋势结论与恢复判定等待完整证据。
            </Notice>
          )}
          {tab === 'detail' && (
            <>
              <Select
                label="蜘蛛"
                value={botId}
                onChange={event => setBotId(event.target.value)}
                options={data.directory.map(bot => [bot.id, bot.name])}
              />
              {bot && (
                <Definition
                  items={[
                    ['平台与用途', `${bot.platformId} · ${labels[bot.type]}`],
                    [
                      '匹配口径',
                      bot.kind === 'robots_purpose'
                        ? 'robots 用途控制项，无独立 HTTP UA'
                        : '按声明 UA 分类，官方范围核验单独统计',
                    ],
                    [
                      '官方说明',
                      <a href={bot.documentationUrl} target="_blank" rel="noreferrer">
                        查看供应商说明
                      </a>,
                    ],
                  ]}
                />
              )}
              {bot?.kind === 'robots_purpose' ? (
                <Notice>
                  Google-Extended 用于声明内容用途。这里不生成独立抓取量、HTTP
                  屏蔽条件或搜索排名结论。
                </Notice>
              ) : (
                <>
                  <Definition
                    items={[
                      [
                        '请求量 / 前期',
                        `${num(sum('requests'))} / ${num(data.previous.bots.filter(row => row.botId === botId).reduce((n, row) => n + row.requests, 0))}`,
                      ],
                      [
                        '有效 GET / 目录页面',
                        `${num(sum('successfulGets'))} / ${num(sum('successfulCatalogPages'))}`,
                      ],
                      ['响应发送字节', num(sum('bytes'))],
                      [
                        '身份核验',
                        `官方范围匹配 ${num(sum('verifiedRange'))} · 未匹配 ${num(sum('rangeMismatch'))} · 未核验 ${num(sum('unverified'))}`,
                      ],
                    ]}
                  />
                  <Table
                    columns={['1xx', '2xx', '3xx（除 304）', '304', '4xx', '5xx', 'HEAD']}
                    rows={[
                      [
                        ...[
                          'status1xx',
                          'status2xx',
                          'status3xx',
                          'status304',
                          'status4xx',
                          'status5xx',
                          'head',
                        ].map(field => num(sum(field))),
                      ],
                    ]}
                    numeric={[0, 1, 2, 3, 4, 5, 6]}
                  />
                  {!metrics.length && (
                    <Notice>
                      当前范围没有此蜘蛛的已映射请求。历史记录与自定义识别规则单列为未映射数据。
                    </Notice>
                  )}
                </>
              )}
              <h3>所属平台关联</h3>
              <p className="muted">
                同一平台的引荐与转化只汇总一次，各蜘蛛详情引用同一份平台数据。抓取与引荐并列观察，单次转化的因果归属需要额外证据。
              </p>
              <p className="muted">前期采用相同长度时间窗。覆盖未知时仅供并列观察。</p>
              <Definition
                items={[
                  [
                    '平台引荐会话 / 前期',
                    `${num(platform?.visits)} / ${num(data.previous.platforms.find(row => row.platformId === bot?.platformId)?.visits)}`,
                  ],
                  [
                    '转化会话 / 目标事件',
                    `${platform?.state === 'available' && platform.conversions == null ? '未配置目标' : num(platform?.conversions)} / ${platform?.state === 'available' && platform.goalEvents == null ? '未配置目标' : num(platform?.goalEvents)}`,
                  ],
                ]}
              />
              <Table
                columns={['原编码路径', 'GET + 2xx', '403 / 429', '本平台终止拦截', '规则匹配']}
                rows={pages.map(row => [
                  <span
                    title={
                      row.mergedPaths?.length > 1 ? '多个编码路径映射到同一浏览器路径' : undefined
                    }
                  >
                    {row.path}
                  </span>,
                  num(row.successfulGets),
                  num(row.denied403429),
                  num(row.ownedTerminatingBlocks),
                  num(row.ownedMatches),
                ])}
                numeric={[1, 2, 3, 4]}
                empty="当前范围没有页面请求"
              />
              {data.pagesTruncated && (
                <Notice>页面按请求量显示前 1,000 项，蜘蛛总量仍使用全部已接收日志。</Notice>
              )}
              <Table
                columns={['平台落地页', '引荐会话', '转化会话 / 目标事件']}
                rows={(platform?.landingPages || []).map(row => [
                  row.path,
                  num(row.visits),
                  `${num(row.conversions)} / ${num(row.goalEvents)}`,
                ])}
                empty="尚无平台落地页证据"
              />
              {platform?.landingPagesTruncated && (
                <Notice>平台落地页按引荐量显示前 1,000 项。</Notice>
              )}
              <p className="muted">
                本平台终止拦截要求终止动作为 block 且规则 ID
                属于本平台；匹配数组单独计数。版本归因显示未知，源站日志无法观测 CDN 已拦请求。
              </p>
              <details>
                <summary>未映射的历史与自定义记录</summary>
                <Table
                  columns={['日志分类', '请求量', '历史分类版本缺失']}
                  rows={data.bots
                    .filter(row => !row.botId)
                    .map(row => [row.name, num(row.requests), num(row.legacyRecords)])}
                />
              </details>
            </>
          )}
          {tab === 'risk' && (
            <>
              <p className="muted">
                等级与证据置信度分别展示。搜索可见性与平台处罚需要独立搜索数据；本页依据访问日志定位技术风险。
              </p>
              <p>
                最近计算：{date(data.analysis?.computedAt, data.range.timezone)}
                {data.analysis?.errorCode ? ' · 更新失败，保留上次结果' : ''}
              </p>
              <Table
                columns={['蜘蛛 / 路径组', '风险', '等级 / 置信度', '证据与窗口', '状态 / 操作']}
                rows={findings.map(row => [
                  `${data.directory.find(bot => bot.id === row.botId)?.name || row.botId} · ${row.pathGroup}`,
                  riskLabels[row.type],
                  <>
                    <Badge
                      tone={
                        row.grade === 'high' ? 'red' : row.grade === 'medium' ? 'amber' : 'gray'
                      }
                    >
                      {gradeLabels[row.grade]}
                    </Badge>{' '}
                    {confidenceLabels[row.confidence]}
                  </>,
                  <>
                    <span>
                      {Object.entries(row.facts.evidence || {})
                        .map(([key, value]) => `${evidenceLabels[key] || key}: ${value ?? '未知'}`)
                        .join(' · ')}
                    </span>
                    <small className="field-help">
                      累计 {row.occurrenceWindows} 个发生窗口 · 截至{' '}
                      {date(row.facts.windowEnd, data.range.timezone)}
                    </small>
                  </>,
                  <>
                    {row.state === 'ignored'
                      ? '已忽略'
                      : row.state === 'resolved'
                        ? '已解除'
                        : row.facts.status === 'pending'
                          ? '待观察'
                          : '待处理'}
                    {data.permissions.canDraft && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await featureRequest('PATCH', `${base}/crawler-findings/${row.key}`, {
                              ignored: row.state !== 'ignored',
                            });
                            reload();
                          })
                        }
                      >
                        {row.state === 'ignored' ? '恢复提醒' : '忽略'}
                      </Button>
                    )}
                  </>,
                ])}
                empty="尚无风险发现。异步计算完成后会显示证据；缺少数据时保持待观察。"
              />
              <form data-unsaved={criticalDirty} onSubmit={event => event.preventDefault()}>
                <label className="field">
                  <span>公开且期望搜索可访问的关键路径，每行一项</span>
                  <textarea
                    value={critical}
                    disabled={!data.permissions.canDraft || busy}
                    onChange={event => {
                      setCritical(event.target.value);
                      setCriticalDirty(true);
                      criticalDirtyRef.current = true;
                    }}
                    rows={4}
                  />
                  <small>关键页面可用低流量规则检查：24 小时内至少 3 次已核验搜索请求受阻。</small>
                </label>
                <Button
                  disabled={!data.permissions.canDraft || busy}
                  onClick={() =>
                    run(async () => {
                      const values = critical
                        .split('\n')
                        .map(value => value.trim())
                        .filter(Boolean);
                      values.forEach(value => crawlerPathSchema.parse({ value, match: 'exact' }));
                      await featureRequest('PATCH', `${base}/crawler-analysis`, { paths: values });
                      setCriticalDirty(false);
                      criticalDirtyRef.current = false;
                      setStatus('关键路径已保存，等待下一轮风险计算。');
                      reload();
                    })
                  }
                >
                  保存关键路径
                </Button>
              </form>
            </>
          )}
          {tab === 'checks' && (
            <>
              <p>
                先验证当前域名，再检查 robots.txt 和指定公开页面。检查使用独立自检
                UA，页面正文不会保存。
              </p>
              <Definition
                items={[
                  ['TXT 记录名称', domain?.name || '正在读取'],
                  ['TXT 值', domain?.value || '创建挑战后显示'],
                  [
                    '验证状态',
                    domain?.verifiedAt ? date(domain.verifiedAt, data.range.timezone) : '待验证',
                  ],
                ]}
              />
              <div className="form-actions">
                <Button
                  disabled={busy || !data.permissions.canDraft}
                  onClick={() =>
                    run(async () => {
                      setDomain(
                        await featureRequest('POST', `${base}/crawler-domain-verification`, {
                          action: 'create',
                        }),
                      );
                    })
                  }
                >
                  创建 TXT 挑战
                </Button>
                <Button
                  disabled={busy || !data.permissions.canDraft}
                  onClick={() =>
                    run(async () => {
                      setDomain(
                        await featureRequest('POST', `${base}/crawler-domain-verification`, {
                          action: 'verify',
                        }),
                      );
                      setStatus('域名验证已通过。请保留 TXT 记录，执行前会再次核验。');
                    })
                  }
                >
                  验证 TXT
                </Button>
              </div>
              <label className="field">
                <span>检查路径，每行一项，最多 20 个</span>
                <textarea value={paths} onChange={event => setPaths(event.target.value)} rows={4} />
              </label>
              <Button
                disabled={busy || !data.permissions.canDraft || !domain?.verifiedAt}
                onClick={() =>
                  run(async () => {
                    await featureRequest('POST', `${base}/crawler-checks`, {
                      paths: selectors().map(row => row.value),
                    });
                    setStatus('检查已排队，可在下方查看结果。');
                    await diagnostics();
                  })
                }
              >
                检查公开页面
              </Button>
              <Table
                columns={['创建时间', '状态', '结果']}
                rows={checks.map(check => [
                  date(check.createdAt, data.range.timezone),
                  {
                    queued: '排队中',
                    running: '检查中',
                    completed: '已完成',
                    failed: '失败',
                    cancelled: '已取消',
                  }[check.state] || check.state,
                  check.result ? (
                    <details>
                      <summary>查看 robots 与响应证据</summary>
                      <pre className="code-block">{JSON.stringify(check.result, null, 2)}</pre>
                    </details>
                  ) : (
                    check.errorCode || '等待 worker 处理'
                  ),
                ])}
              />
            </>
          )}
          {tab === 'control' && (
            <>
              {controlPanel ? (
                controlPanel(data.permissions)
              ) : (
                <CrawlerPoliciesPanel websiteId={websiteId} permissions={data.permissions} />
              )}
              <details>
                <summary>导出 robots.txt 与 Nginx 配置</summary>
                <Select
                  label="蜘蛛"
                  value={botId}
                  onChange={event => setBotId(event.target.value)}
                  options={data.directory.map(bot => [bot.id, bot.name])}
                />
                <Select
                  label="导出动作"
                  value={exportAction}
                  onChange={event => setExportAction(event.target.value)}
                  options={[
                    ['block', '禁止 / 屏蔽'],
                    ['allow', 'robots 允许'],
                    ['rate', 'Nginx 限速'],
                  ]}
                />
                <Select
                  label="路径匹配"
                  value={exportMatch}
                  onChange={event => setExportMatch(event.target.value as 'exact' | 'prefix')}
                  options={[
                    ['exact', '精确路径'],
                    ['prefix', '目录段前缀'],
                  ]}
                />
                {exportAction === 'rate' && (
                  <div>
                    <label className="field">
                      <span>每 IP 每秒请求数</span>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={rate}
                        onChange={event => setRate(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>突发请求数</span>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={burst}
                        onChange={event => setBurst(event.target.value)}
                      />
                    </label>
                    <Notice>
                      Nginx 片段按 IP 限速，初始为 dry-run。部署前核对真实 IP 与现有 limit_req
                      配置。
                    </Notice>
                  </div>
                )}
                <label className="field">
                  <span>原编码路径，每行一项</span>
                  <textarea
                    value={paths}
                    onChange={event => setPaths(event.target.value)}
                    rows={4}
                  />
                </label>
                <div className="form-actions">
                  <Button
                    disabled={busy || exportAction === 'rate'}
                    onClick={() =>
                      run(async () => {
                        const output = await featureRequest('POST', `${base}/crawler-exports`, {
                          kind: 'robots',
                          policy: {
                            botIds: [botId],
                            paths: selectors(exportMatch),
                            action: exportAction,
                          },
                        });
                        setFragment(output.content || output.fragment);
                        setStatus(
                          output.safe
                            ? '已保留原文件并生成追加内容。部署前请核对现网 robots.txt。'
                            : `需要手动合并：${output.reasons.join('；')}`,
                        );
                      })
                    }
                  >
                    生成 robots.txt 草稿
                  </Button>
                  <Button
                    disabled={busy || bot?.kind === 'robots_purpose' || exportAction === 'allow'}
                    onClick={() =>
                      run(async () => {
                        const output = await featureRequest('POST', `${base}/crawler-exports`, {
                          kind: 'nginx',
                          policy: {
                            name: '导出策略',
                            botIds: [botId],
                            paths: selectors(exportMatch),
                            action: exportAction === 'rate' ? 'observe' : 'block',
                            expectedAccess: exportAction === 'rate' ? 'allow' : 'block',
                          },
                          ...(exportAction === 'rate'
                            ? {
                                rateLimit: {
                                  requestsPerSecond: Number(rate),
                                  burst: Number(burst),
                                  dryRun: true,
                                },
                              }
                            : {}),
                        });
                        setFragment(
                          exportAction === 'rate' && output.rateLimit
                            ? `${output.httpContext}\n${output.rateLimit.httpContext}\n${output.rateLimit.serverContext}`
                            : `${output.httpContext}\n${output.serverContext}`,
                        );
                        setStatus('配置片段已生成。请结合原配置核对并通过 nginx -t 后部署。');
                      })
                    }
                  >
                    生成 Nginx 配置片段
                  </Button>
                  <Button
                    disabled={!fragment}
                    onClick={() =>
                      downloadFile(
                        fragment,
                        'liekan-crawler-policy.txt',
                        'text/plain;charset=utf-8',
                      )
                    }
                  >
                    下载当前草稿
                  </Button>
                </div>
                {fragment && <pre className="code-block">{fragment}</pre>}
              </details>
            </>
          )}
        </>
      )}
    </LiekanDialog>
  );
}
