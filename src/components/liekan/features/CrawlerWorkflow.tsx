'use client';
import { useEffect, useRef, useState } from 'react';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { featureRequest } from '@/lib/liekan/upstream/features-client';
import { Button, Notice, Panel, Select, Table } from './ui';
import { TrafficEvidencePanel } from './TrafficEvidencePanel';
export function CrawlerWorkflow({
  websiteId,
  hostname,
  finding,
  timezone,
  onChanged,
  onChecks,
  onControl,
}: {
  websiteId: string;
  hostname: string;
  finding: any;
  timezone: string;
  onChanged: () => void;
  onChecks: () => void;
  onControl: () => void;
}) {
  const i18n = useLiekanI18n(),
    base = `/liekan/websites/${websiteId}`;
  const [data, setData] = useState<any>(),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(1),
    [actionPage, setActionPage] = useState(1),
    [history, setHistory] = useState('current'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [note, setNote] = useState(''),
    [title, setTitle] = useState(''),
    [occurredAt, setOccurredAt] = useState(''),
    [hours, setHours] = useState('24'),
    [showEvidence, setShowEvidence] = useState(false);
  const [reference, setReference] = useState<{
    referenceId: string;
    referenceSource: string;
  } | null>(null);
  const retry = useRef<{ key: string; body: any } | null>(null);
  const endAt = Number(finding.facts?.windowEnd) || +new Date(finding.windowEnd);
  const startAt = Number(finding.facts?.windowStart) || endAt - 3600000;
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    setData(undefined);
    featureRequest<any>(
      'GET',
      `${base}/crawler-context`,
      {
        findingKey: finding.key,
        startAt: startAt - 86400000,
        endAt: Math.min(endAt + 86400000, Date.now() + 86400000),
        page,
        actionPage,
        history,
        ...reference,
      },
      abort.signal,
    )
      .then(result => {
        if (!abort.signal.aborted) setData(result);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [base, finding.key, startAt, endAt, page, actionPage, history, revision, reference]);
  const mutate = async (method: 'POST' | 'PATCH', url: string, payload: any) => {
    const key = JSON.stringify([method, url, payload]);
    if (retry.current?.key !== key)
      retry.current = { key, body: { ...payload, requestId: crypto.randomUUID() } };
    setBusy(true);
    setError('');
    try {
      await featureRequest(method, url, retry.current.body);
      retry.current = null;
      setNote('');
      setRevision(n => n + 1);
      onChanged();
    } catch (e: any) {
      setError(e.message);
      if (e.status === 409) {
        retry.current = null;
        setRevision(n => n + 1);
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };
  const act = (action: string) =>
    mutate('PATCH', `${base}/crawler-findings/${encodeURIComponent(finding.key)}/workflow`, {
      action,
      expectedWorkflowRevision: data.workflow.workflowRevision,
      occurrenceVersion: data.workflow.occurrenceVersion,
      factVersion: data.workflow.factVersion,
      ...(action === 'snooze' ? { hours: Number(hours) } : {}),
      ...(note ? { note } : {}),
    });
  return (
    <Panel title={i18n.text('风险上下文与处理')}>
      <div className="panel-body stack">
        {error && <Notice tone="red">{i18n.system(error)}</Notice>}
        {!data && !error && <Notice>{i18n.text('正在读取')}</Notice>}
        {data && (
          <>
            <Notice>
              {i18n.text(
                '处理状态独立于检测事实；暂缓和已查看不会将技术风险标记为恢复。上下文时间接近仅提供排查线索。',
              )}
            </Notice>
            <p>
              {i18n.text('发生轮次')} {data.workflow.occurrenceVersion} · {i18n.text('处理状态')}{' '}
              {i18n.text(
                { pending: '待处理', viewed: '已查看', snoozed: '已暂缓' }[data.workflow.state],
              )}{' '}
              {data.workflow.snoozedUntil || ''}
            </p>
            <p>
              {i18n.text(
                {
                  access: '核对拒绝响应及已有阻断依据。',
                  origin: '核对源站错误、延迟与部署记录。',
                  surge: '核对流量基线、来源采样及请求峰值。',
                  identity: '核对官方地址来源、时效与身份不匹配理由。',
                  sensitive_path: '核对敏感路径定义与实际请求范围。',
                  coverage: '核对页面目录、GET 2xx 响应与来源覆盖。',
                  observation: '核对观察样本及缺失字段。',
                }[finding.type] || '确认来源连续性、身份依据与触发窗口。',
              )}
            </p>
            <ol>
              <li>{i18n.text('确认来源连续性、身份依据与触发窗口。')}</li>
              <li>{i18n.text('检查响应码、公开文件与策略记录。')}</li>
              <li>{i18n.text('对照人工上下文并记录判断，必要时进入独立预览流程。')}</li>
            </ol>
            <p>{i18n.text('检测范围沿用原规则总体；证据入口恢复该风险窗口。')}</p>
            <div className="actions">
              <Button onClick={() => setShowEvidence(value => !value)}>
                {i18n.text('查看触发窗口证据')}
              </Button>
              <Button onClick={onChecks}>{i18n.text('查看公开检查')}</Button>
              <Button onClick={onControl}>{i18n.text('查看策略预览')}</Button>
            </div>
            {showEvidence && (
              <TrafficEvidencePanel
                websiteId={websiteId}
                hostname={hostname}
                range={{ startAt, endAt, timezone }}
                botId={finding.botId}
                path={finding.pathGroup?.startsWith('/') ? finding.pathGroup : undefined}
                identityScope="all"
              />
            )}
            {data.canDraft && (
              <form
                className="stack"
                onSubmit={event => event.preventDefault()}
                data-unsaved={!!note || !!title}
              >
                <label className="field">
                  <span>{i18n.text('处理备注')}</span>
                  <textarea
                    value={note}
                    maxLength={1000}
                    onChange={event => setNote(event.target.value)}
                    rows={3}
                  />
                </label>
                <div className="actions">
                  <Button
                    disabled={busy || data.workflow.finding.state !== 'active'}
                    onClick={() => act('view')}
                  >
                    {i18n.text('标记已查看')}
                  </Button>
                  <Select
                    label={i18n.text('暂缓时长')}
                    value={hours}
                    onChange={event => setHours(event.target.value)}
                    options={[
                      ['1', i18n.text('1 小时')],
                      ['24', i18n.text('24 小时')],
                      ['168', i18n.text('7 天')],
                    ]}
                  />
                  <Button
                    disabled={busy || data.workflow.finding.state !== 'active'}
                    onClick={() => act('snooze')}
                  >
                    {i18n.text('暂缓')}
                  </Button>
                  <Button
                    disabled={busy || data.workflow.finding.state !== 'active'}
                    onClick={() => act('resume')}
                  >
                    {i18n.text('恢复待处理')}
                  </Button>
                  <Button disabled={busy || !note.trim()} onClick={() => act('comment')}>
                    {i18n.text('添加备注')}
                  </Button>
                </div>
                <label className="field">
                  <span>{i18n.text('人工上下文标题')}</span>
                  <input
                    value={title}
                    maxLength={120}
                    onChange={event => setTitle(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{i18n.text('实际发生时间')}</span>
                  <input
                    type="datetime-local"
                    value={occurredAt}
                    onChange={event => setOccurredAt(event.target.value)}
                  />
                </label>
                <Button
                  disabled={busy || !title.trim() || !occurredAt}
                  onClick={() => {
                    const when = new Date(occurredAt);
                    if (Number.isFinite(+when))
                      void mutate('POST', `${base}/crawler-context`, {
                        title,
                        note,
                        occurredAt: when.toISOString(),
                      });
                  }}
                >
                  {i18n.text('登记人工上下文')}
                </Button>
              </form>
            )}
            <Select
              label={i18n.text('上下文范围')}
              value={history}
              onChange={event => {
                setHistory(event.target.value);
                setPage(1);
              }}
              options={[
                ['current', i18n.text('当前统计代次')],
                ['all', i18n.text('含历史人工记录')],
              ]}
            />
            <Table
              columns={[
                i18n.text('来源'),
                i18n.text('实际发生时间'),
                i18n.text('录入时间'),
                i18n.text('说明'),
                i18n.text('操作'),
              ]}
              rows={data.rows.map(row => [
                i18n.text(
                  {
                    manual: '人工记录',
                    policy: '策略记录',
                    check: '公开检查',
                    catalog: '目录快照',
                  }[row.source],
                ),
                row.occurred_at,
                row.created_at,
                `${row.title} · ${row.note}${row.source === 'manual' ? ` · ${i18n.text('统计代次')} ${row.epoch ?? i18n.text('未知')}` : ''}${row.voided_at ? ` · ${i18n.text('已作废')}` : ''}`,
                row.source !== 'manual' ? (
                  <Button
                    onClick={() =>
                      setReference({ referenceId: row.id, referenceSource: row.source })
                    }
                  >
                    {i18n.text('查看原始证据')}
                  </Button>
                ) : row.source === 'manual' && !row.voided_at && data.canDraft ? (
                  <Button
                    disabled={busy || !note.trim()}
                    onClick={() =>
                      mutate('POST', `${base}/crawler-context/${row.id}/void`, { reason: note })
                    }
                  >
                    {i18n.text('以备注为原因作废')}
                  </Button>
                ) : null,
              ])}
              page={data.page}
              pages={Math.ceil(data.total / 20)}
              onPage={setPage}
            />
            {data.evidence && (
              <details open>
                <summary>
                  {i18n.text('原始证据')} · {data.evidence.id}
                </summary>
                <pre className="code-block">{JSON.stringify(data.evidence.record, null, 2)}</pre>
              </details>
            )}
            <Table
              columns={[
                i18n.text('操作'),
                i18n.text('时间'),
                i18n.text('操作者'),
                i18n.text('备注'),
              ]}
              rows={data.actions.map(row => [
                i18n.text(
                  { view: '标记已查看', snooze: '暂缓', resume: '恢复待处理', comment: '添加备注' }[
                    row.action
                  ] || row.action,
                ),
                row.occurred_at,
                row.actor_id || i18n.text('已删除用户'),
                row.note,
              ])}
              page={data.actionPage}
              pages={Math.ceil(data.actionTotal / 20)}
              onPage={setActionPage}
            />
          </>
        )}
      </div>
    </Panel>
  );
}
