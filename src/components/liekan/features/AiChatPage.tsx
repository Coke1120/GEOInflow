'use client';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { DataState } from '@/lib/liekan/contracts/report';
import { type AiCatalog, type AiMessage, aiClient } from '@/lib/liekan/upstream/ai-client';
import {
  AiButton,
  AiModal,
  AiNotice,
  aiError,
  ModelWindow,
  ModuleNotice,
  RunMetrics,
  RunStatus,
  record,
  styles,
  useAiCatalog,
  useAiRun,
  uuid,
} from './AiShared';
import { useFeature } from './context';

const dataStateLabels: Record<DataState | 'actual' | 'zero' | 'unknown', string> = {
  available: '实际数据',
  actual: '实际数据',
  empty: '暂无数据',
  zero: '实际值为 0',
  estimated: '估算数据',
  unsupported: '暂不支持',
  not_connected: '尚未接入',
  unknown: '未知',
};
const sourceLabels: Record<string, string> = {
  logs: 'AI日志',
  goals: '转化目标',
  human: '访客统计',
  catalog: '网站目录',
  aiReferrals: 'AI引荐',
};
function dataStateLabel(value: unknown) {
  const state =
    typeof value === 'string' && Object.hasOwn(dataStateLabels, value)
      ? (value as keyof typeof dataStateLabels)
      : 'unknown';
  return dataStateLabels[state];
}
function sourceLabel(value: string) {
  return Object.hasOwn(sourceLabels, value) ? sourceLabels[value] : '未知来源';
}
const questions = [
  '分析最近 7 天的 AI 抓取趋势',
  '哪些页面值得优先优化？',
  '检查 AI 来源与转化表现',
];
export function AiChatPage() {
  const c = useFeature(),
    catalog = useAiCatalog();
  const [siteId, setSiteId] = useState(c.query.aiSite || '');
  useEffect(() => {
    setSiteId(c.query.aiSite || '');
  }, [c.query.aiSite, c.query.aiConversation]);
  if (catalog.isPending)
    return (
      <div data-liekan-ai="ai-chat" className={styles.chatWorkspace}>
        <AiNotice>正在读取 AI 能力与可访问网站…</AiNotice>
      </div>
    );
  if (catalog.error)
    return (
      <div data-liekan-ai="ai-chat" className={styles.chatWorkspace}>
        <AiNotice error>{aiError(catalog.error)}</AiNotice>
        <AiButton onClick={() => void catalog.refetch()}>重新读取</AiButton>
      </div>
    );
  const data = catalog.data;
  if (!data) return null;
  const site = data.websites.find(s => s.id === siteId),
    space = data.spaces.find(s => s.kind === site?.space.kind && s.id === site?.space.id);
  const changeSite = (id: string) => {
    setSiteId(id);
    c.navigate('ai-chat', id ? { aiSite: id } : {});
  };
  return (
    <div data-liekan-ai="ai-chat" className={styles.chatWorkspace} lang="zh-CN">
      <ModuleNotice catalog={data} />
      {site && space ? (
        <SiteConversation
          key={site.id}
          catalog={data}
          site={site}
          space={space}
          changeSite={changeSite}
        />
      ) : (
        <>
          <div className={styles.scope}>
            <label>
              网站
              <select aria-label="分析网站" value="" onChange={e => changeSite(e.target.value)}>
                <option value="">请明确选择网站</option>
                {data.websites.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {siteId && <AiNotice error>所选网站不可访问或归属已变更，请重新选择。</AiNotice>}
          <div className={styles.welcome}>
            <h2>从一个问题开始，读懂网站表现</h2>
            <p>选择网站、确认日期，再结合统计依据开展分析。</p>
          </div>
          <div className={styles.composer}>
            <textarea aria-label="分析问题" disabled placeholder="先选择需要分析的网站" />
            <div className={styles.composerActions}>
              <span>每次分析绑定一个明确的网站</span>
              <AiButton primary disabled>
                发起分析
              </AiButton>
            </div>
          </div>
          {!data.websites.length && (
            <AiNotice>当前账户没有可访问的网站。请先在网站管理添加网站或获取团队权限。</AiNotice>
          )}
        </>
      )}
    </div>
  );
}
function SiteConversation({
  catalog,
  site,
  space,
  changeSite,
}: {
  catalog: AiCatalog;
  site: AiCatalog['websites'][number];
  space: AiCatalog['spaces'][number];
  changeSite: (id: string) => void;
}) {
  const c = useFeature(),
    client = useQueryClient(),
    timezone = c.range.timezone || 'Asia/Shanghai';
  const routeScope = c.query.aiSite === site.id;
  const routeConversation =
    routeScope && uuid.test(c.query.aiConversation || '') ? c.query.aiConversation : '';
  const [connectionId, setConnectionId] = useState(''),
    [question, setQuestion] = useState(''),
    [sentQuestion, setSentQuestion] = useState(''),
    [conversationId, setConversationId] = useState(routeConversation),
    [switching, setSwitching] = useState(false),
    [pendingConversation, setPendingConversation] = useState<string | null>(null),
    [error, setError] = useState(''),
    [creating, setCreating] = useState(false),
    [reference, setReference] = useState<string | null>(null),
    [deleting, setDeleting] = useState<string | null>(null);
  const [dates, setDates] = useState(() => {
    const now = new Date(),
      day = formatInTimeZone(now, timezone, 'yyyy-MM-dd'),
      start = new Date(`${day}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start: start.toISOString().slice(0, 10), end: day };
  });
  const task = useAiRun(`liekan-ai:${c.user.id}:analysis:${site.id}`, () => {
    void client.invalidateQueries({ queryKey: ['liekan-ai', c.user.id, 'messages'] });
    void client.invalidateQueries({ queryKey: ['liekan-ai', c.user.id, 'history', site.id] });
  });
  const alive = useRef(true),
    selectionEpoch = useRef(0),
    conversationRef = useRef(conversationId),
    routeRef = useRef(routeConversation),
    observedRoute = useRef(routeConversation),
    pendingSelection = useRef<{ id: string; busy: boolean } | null>(null),
    taskRef = useRef(task),
    contextRef = useRef(c);
  taskRef.current = task;
  contextRef.current = c;
  routeRef.current = routeConversation;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      selectionEpoch.current++;
    };
  }, []);
  const selectConversation = useCallback(
    async (id: string, source: 'internal' | 'route' | 'restore' = 'internal') => {
      if (pendingSelection.current?.id === id && pendingSelection.current.busy) return false;
      const currentTask = taskRef.current;
      const recoveredId = currentTask.metadata?.conversationId;
      if (
        source === 'route' &&
        !pendingSelection.current &&
        id === conversationRef.current &&
        (!recoveredId || recoveredId === id)
      ) {
        pendingSelection.current = null;
        setPendingConversation(null);
        return true;
      }
      // Adopt a restored task only when the URL has no explicit conversation.
      const restoring =
        source === 'restore' &&
        !routeRef.current &&
        !conversationRef.current &&
        !pendingSelection.current;
      const epoch = ++selectionEpoch.current;
      pendingSelection.current = { id, busy: true };
      setPendingConversation(id);
      setSwitching(true);
      if (!restoring) {
        const stopped = await currentTask.stop();
        if (!alive.current || epoch !== selectionEpoch.current) return false;
        if (!stopped || !taskRef.current.reset()) {
          pendingSelection.current = { id, busy: false };
          setSwitching(false);
          return false;
        }
      }
      if (!alive.current || epoch !== selectionEpoch.current) return false;
      conversationRef.current = id;
      setConversationId(id);
      setQuestion('');
      setSentQuestion('');
      setReference(null);
      setDeleting(null);
      setCreating(false);
      setError('');
      pendingSelection.current = null;
      setPendingConversation(null);
      setSwitching(false);
      if (source !== 'route')
        contextRef.current.navigate('ai-chat', {
          aiSite: site.id,
          ...(id ? { aiConversation: id } : {}),
        });
      return true;
    },
    [site.id],
  );
  useEffect(() => {
    if (!routeScope || observedRoute.current === routeConversation) return;
    observedRoute.current = routeConversation;
    void selectConversation(routeConversation, 'route');
  }, [routeScope, routeConversation, selectConversation]);
  const restoredConversation = task.metadata?.conversationId;
  useEffect(() => {
    if (!routeScope || !restoredConversation || !uuid.test(restoredConversation)) return;
    if (!routeRef.current && !conversationRef.current)
      void selectConversation(restoredConversation, 'restore');
    else if (conversationRef.current !== restoredConversation)
      void selectConversation(routeRef.current || conversationRef.current, 'route');
  }, [routeScope, restoredConversation, selectConversation]);
  const connections = useQuery({
    queryKey: ['liekan-ai', c.user.id, 'connections', space.kind, space.id],
    queryFn: ({ signal }) => aiClient.connections({ kind: space.kind, id: space.id }, signal),
    enabled: catalog.module.enabled,
    retry: false,
  });
  const usable = (connections.data?.items || []).filter(
    r =>
      r.enabled &&
      r.testState === 'connected' &&
      r.hasKey &&
      r.capabilities.keyVerified.text === true,
  );
  const selected =
    usable.find(r => r.id === connectionId) ||
    (!connectionId ? usable.find(r => r.isDefault) : undefined);
  const history = useInfiniteQuery({
    queryKey: ['liekan-ai', c.user.id, 'history', site.id],
    queryFn: ({ pageParam, signal }) => aiClient.conversations(site.id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor || undefined,
    enabled: catalog.module.enabled,
    retry: false,
  });
  const messages = useInfiniteQuery({
    queryKey: ['liekan-ai', c.user.id, 'messages', conversationId],
    queryFn: ({ pageParam, signal }) => aiClient.messages(conversationId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor || undefined,
    enabled: !!conversationId && catalog.module.enabled,
    retry: false,
  });
  const allMessages =
    messages.data?.pages
      .flatMap(p => p.items)
      .slice()
      .reverse() || [];
  const routePending = pendingConversation !== null || routeConversation !== observedRoute.current;
  const busy = task.busy || creating || switching || routePending;
  const showCurrentTask =
    !task.metadata?.conversationId || task.metadata.conversationId === conversationId;
  const blocked =
    !catalog.module.enabled ||
    !space.canUse ||
    connections.isPending ||
    !!connections.error ||
    busy;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    setError('');
    const text = question.trim(),
      start = fromZonedTime(`${dates.start}T00:00:00.000`, timezone).getTime(),
      end = fromZonedTime(`${dates.end}T23:59:59.999`, timezone).getTime();
    if (!text || Array.from(text).length > catalog.limits.maxQuestionCharacters) {
      setError(`请填写 1 至 ${catalog.limits.maxQuestionCharacters} 字的问题。`);
      return;
    }
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start ||
      end - start + 1 > catalog.limits.maxDays * 86400000 ||
      start > Date.now()
    ) {
      setError(`请选择有效日期范围，上限 ${catalog.limits.maxDays} 天。`);
      return;
    }
    if (connectionId && connectionId !== 'local' && !selected) {
      setError('所选连接已更新，请重新选择当前可用连接。');
      return;
    }
    if (task.recoverable) {
      setError('请先回查原任务。确认任务结束后，可重新发起新调用。');
      return;
    }
    let id = conversationRef.current;
    const epoch = selectionEpoch.current,
      submittedRoute = routeRef.current;
    setCreating(true);
    try {
      if (!id) {
        const created = await aiClient.createConversation(site.id);
        if (created.websiteId !== site.id || !uuid.test(created.id)) throw { code: 'conflict' };
        id = created.id;
        if (
          !alive.current ||
          epoch !== selectionEpoch.current ||
          routeRef.current !== submittedRoute
        )
          return;
        conversationRef.current = id;
        setConversationId(id);
        c.navigate('ai-chat', { aiSite: site.id, aiConversation: id });
      }
      if (
        !alive.current ||
        epoch !== selectionEpoch.current ||
        routeRef.current !== submittedRoute ||
        !task.reset()
      )
        return;
      setSentQuestion(text);
      setQuestion('');
      void task.start(
        `/liekan/ai/conversations/${id}/messages`,
        {
          question: text,
          ...(selected ? { connectionId: selected.id } : { localOnly: true }),
          expectedConfigVersion: selected?.configVersion || 1,
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          timezone,
        },
        { siteId: site.id, conversationId: id },
      );
    } catch (e) {
      if (alive.current && epoch === selectionEpoch.current) setError(aiError(e));
    } finally {
      if (alive.current && epoch === selectionEpoch.current) setCreating(false);
    }
  };
  return (
    <>
      <div className={styles.scope}>
        <label>
          网站
          <select
            aria-label="分析网站"
            value={site.id}
            disabled={creating || switching || routePending}
            onChange={async e => {
              const id = e.target.value;
              if (await task.stop()) changeSite(id);
            }}
          >
            <option value="">请明确选择网站</option>
            {catalog.websites.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <span>
          {space.name} · {site.domain}
        </span>
        <span className={styles.badge}>{space.canUse ? '可分析' : '只读权限'}</span>
      </div>
      <div className={styles.dateScope}>
        <label>
          开始日期
          <input
            aria-label="分析开始日期"
            type="date"
            value={dates.start}
            disabled={busy}
            onChange={e => setDates(d => ({ ...d, start: e.target.value }))}
          />
        </label>
        <label>
          结束日期
          <input
            aria-label="分析结束日期"
            type="date"
            value={dates.end}
            disabled={busy}
            onChange={e => setDates(d => ({ ...d, end: e.target.value }))}
          />
        </label>
        <span>
          统计时区：{timezone} · 最长 {catalog.limits.maxDays} 天
        </span>
      </div>
      {!space.canUse && (
        <AiNotice>
          当前网站所属空间为只读权限，无法执行 AI 分析或付费测试。可以查看你自己的可访问历史。
        </AiNotice>
      )}
      {connections.error && (
        <>
          <AiNotice error>{aiError(connections.error)}</AiNotice>
          <AiButton onClick={() => void connections.refetch()}>重新读取连接</AiButton>
        </>
      )}
      {!selected && !connections.isPending && !connections.error && (
        <div className={styles.connectHint}>
          <div>
            <strong>当前空间尚无已验证的默认连接</strong>
            <p>可以先查看本地接入指引。配置并测试模型后，可获得 AI 分析。</p>
          </div>
          <a className={styles.button} href={c.href('ai-config', { aiSite: site.id })}>
            配置 API
          </a>
        </div>
      )}
      {routePending && (
        <AiNotice error={!switching}>
          {switching
            ? '正在确认原任务状态并切换对话…'
            : '对话切换未完成，提交已暂停。请确认原任务状态后重试。'}
          {!switching && (
            <AiButton
              onClick={() =>
                void selectConversation(pendingConversation ?? routeRef.current, 'route')
              }
            >
              重试切换对话
            </AiButton>
          )}
        </AiNotice>
      )}
      <div className={styles.conversationTools}>
        <AiButton disabled={busy} onClick={() => void selectConversation('')}>
          新建对话
        </AiButton>
        <details>
          <summary>我的历史对话</summary>
          <div className={styles.history}>
            {history.error ? (
              <AiNotice error>{aiError(history.error)}</AiNotice>
            ) : history.isPending ? (
              <p>正在读取历史…</p>
            ) : !history.data?.pages.some(p => p.items.length) ? (
              <p>当前网站暂无本人历史对话。</p>
            ) : (
              history.data.pages
                .flatMap(p => p.items)
                .map(item => (
                  <div key={item.id}>
                    <AiButton disabled={busy} onClick={() => void selectConversation(item.id)}>
                      {item.title} · {formatInTimeZone(item.updatedAt, timezone, 'MM-dd HH:mm')}
                    </AiButton>
                    <AiButton
                      aria-label={`删除对话 ${item.title}`}
                      disabled={busy}
                      onClick={() => setDeleting(item.id)}
                    >
                      删除
                    </AiButton>
                  </div>
                ))
            )}
            {history.hasNextPage && (
              <AiButton
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                加载更多对话
              </AiButton>
            )}
          </div>
        </details>
      </div>
      {!allMessages.length && !task.run && !task.preview && !task.busy && (
        <div className={styles.welcome}>
          <h2>从一个问题开始，读懂网站表现</h2>
          <p>结合 AI 抓取、访客来源、页面与转化记录，找到下一步。</p>
        </div>
      )}
      {messages.error && (
        <>
          <AiNotice error>{aiError(messages.error)}</AiNotice>
          <AiButton onClick={() => void selectConversation('')}>新建对话</AiButton>
        </>
      )}
      {messages.hasNextPage && (
        <AiButton
          disabled={messages.isFetchingNextPage}
          onClick={() => void messages.fetchNextPage()}
        >
          加载更早消息
        </AiButton>
      )}
      <div className={styles.conversation}>
        {allMessages.map(message => (
          <HistoryMessage
            key={message.id}
            message={message}
            siteId={site.id}
            onReference={setReference}
          />
        ))}
        {showCurrentTask &&
          !allMessages.some(m => m.runId === task.run?.id) &&
          (sentQuestion || task.run || task.preview || task.busy) && (
            <>
              <div className={styles.userMessage}>
                {sentQuestion || '正在恢复原任务，问题内容从历史读取。'}
              </div>
              <div className={styles.assistantMessage}>
                <div className={styles.messageHeading}>
                  猎看分析 <RunStatus state={task.stage} />
                </div>
                {task.run?.state === 'completed' ? (
                  <Answer
                    result={task.run.result}
                    origin={String(record(task.run.result).origin || '')}
                    siteId={site.id}
                    onReference={setReference}
                  />
                ) : (
                  <>
                    <p className={styles.muted}>实时预览 · 尚未校验</p>
                    <div className={styles.preview}>
                      {task.preview ||
                        (task.error
                          ? '本次生成未完成。请按提示回查或重新填写问题。'
                          : '正在读取统计依据…')}
                    </div>
                  </>
                )}
                <RunMetrics run={task.run} />
                {task.run?.error && <AiNotice error>{aiError(task.run.error)}</AiNotice>}
              </div>
            </>
          )}
      </div>
      {task.error && <AiNotice error>{task.error}</AiNotice>}
      {error && <AiNotice error>{error}</AiNotice>}
      {task.error && !task.recoverable && !task.busy && sentQuestion && (
        <div className={styles.actions}>
          <AiButton onClick={() => setQuestion(sentQuestion)}>重新填写问题</AiButton>
          <span className={styles.muted}>重新发起会创建新调用，可能产生费用。</span>
        </div>
      )}
      {task.recoverable && (
        <div className={styles.actions}>
          <AiButton disabled={task.busy} onClick={() => void task.recover()}>
            回查原任务
          </AiButton>
          <span className={styles.muted}>刷新恢复仅查询原任务，不会重复调用模型。</span>
        </div>
      )}
      <form onSubmit={submit} className={styles.composer}>
        <textarea
          aria-label="分析问题"
          value={question}
          maxLength={catalog.limits.maxQuestionCharacters}
          placeholder="问问网站最近发生了什么，或者描述你想核查的变化"
          disabled={!catalog.module.enabled || !space.canUse || busy}
          onChange={e => setQuestion(e.target.value)}
        />
        <div className={styles.composerActions}>
          <label>
            <select
              aria-label="分析模型"
              value={connectionId || selected?.id || 'local'}
              disabled={busy || !space.canUse || !catalog.module.enabled}
              onChange={e => setConnectionId(e.target.value)}
            >
              <option value="local">本地接入指引 · 无模型调用</option>
              {usable.map(row => (
                <option key={row.id} value={row.id}>
                  {row.name} · {row.model}
                  {row.isDefault ? ' · 默认' : ''}
                </option>
              ))}
            </select>
          </label>
          {busy ? (
            <AiButton onClick={() => void task.stop()}>停止分析</AiButton>
          ) : (
            <AiButton
              primary
              type="submit"
              disabled={blocked || !question.trim() || task.recoverable}
            >
              {selected ? '发起分析' : '查看接入指引'}
            </AiButton>
          )}
        </div>
        <section className={styles.callDisclosure} aria-label="分析调用说明">
          {selected ? (
            <>
              <p>
                供应商：
                {catalog.templates.find(t => t.provider === selected.provider)?.name ||
                  '自定义兼容接口'}{' '}
                · 模型：{selected.model}
              </p>
              <p>
                应用上下文窗口：
                <ModelWindow catalog={catalog} configuration={selected} />
              </p>
              <p>将外发脱敏汇总、有限样本、本次问题与最多 6 轮历史；调用可能产生供应商费用。</p>
            </>
          ) : (
            <p>本地统计指引 · 0 次供应商调用。统计依据与问题由当前实例处理。</p>
          )}
          <p>请勿输入凭据、密钥或个人资料。</p>
        </section>
      </form>
      {!allMessages.length && (
        <div className={styles.shortcuts}>
          <div className={styles.sectionHeading}>
            <h3>从这些问题开始</h3>
            <span className={styles.muted}>选择后填入输入框</span>
          </div>
          <div className={styles.functionGrid}>
            {questions.map(text => (
              <AiButton
                key={text}
                disabled={busy || !space.canUse || !catalog.module.enabled}
                onClick={() => setQuestion(text)}
              >
                {text}
              </AiButton>
            ))}
          </div>
        </div>
      )}
      <p className={styles.footnote}>
        回答基于本次统计快照。日志覆盖未经验证；当前页面可能随新数据变化。供应商调用可能产生费用。
      </p>
      {reference && conversationId && (
        <ContextSnapshot
          conversationId={conversationId}
          contextId={reference}
          onClose={() => setReference(null)}
        />
      )}
      {deleting && (
        <AiModal title="删除历史对话" onClose={() => setDeleting(null)}>
          <div className={styles.modalBody}>
            <p>确认删除该对话和生成时依据？删除后无法继续读取。</p>
            {error && <AiNotice error>{error}</AiNotice>}
          </div>
          <div className={styles.modalFooter}>
            <AiButton onClick={() => setDeleting(null)}>取消</AiButton>
            <AiButton
              primary
              onClick={async () => {
                try {
                  await aiClient.deleteConversation(deleting);
                  if (deleting === conversationId) await selectConversation('');
                  setDeleting(null);
                  await client.invalidateQueries({
                    queryKey: ['liekan-ai', c.user.id, 'history', site.id],
                  });
                } catch (e) {
                  setError(aiError(e));
                }
              }}
            >
              删除对话
            </AiButton>
          </div>
        </AiModal>
      )}
    </>
  );
}
function HistoryMessage({
  message,
  siteId,
  onReference,
}: {
  message: AiMessage;
  siteId: string;
  onReference: (id: string) => void;
}) {
  return (
    <>
      <div className={styles.userMessage}>{message.question}</div>
      <div className={styles.assistantMessage}>
        <div className={styles.messageHeading}>
          猎看分析 <span className={styles.badge}>历史回答</span>
        </div>
        {message.state === 'completed' && message.result ? (
          <Answer
            result={message.result}
            origin={message.origin}
            siteId={siteId}
            onReference={onReference}
          />
        ) : (
          <AiNotice>此历史任务未完成，状态：{message.state || '未知'}。</AiNotice>
        )}
      </div>
    </>
  );
}
function safeAction(input: unknown, siteId: string) {
  const value = record(input),
    allowed = [
      'geo-ai',
      'geo-bots',
      'geo-ai-pages',
      'geo-logs',
      'geo-sources',
      'geo-content',
      'geo-conversions',
      'tracking',
    ];
  if (
    !allowed.includes(String(value.action)) ||
    typeof value.href !== 'string' ||
    typeof value.label !== 'string' ||
    !value.href.startsWith('/') ||
    value.href.startsWith('//') ||
    /[\\\p{Cc}]/u.test(value.href)
  )
    return null;
  try {
    const url = new URL(value.href, 'https://liekan.local');
    const sitePath = `/websites/${siteId}/geo`;
    const own =
      (url.pathname === `/liekan/tracking` && url.searchParams.get('websiteId') === siteId) ||
      url.pathname === sitePath ||
      url.pathname.startsWith(`${sitePath}/`);
    return own ? { href: value.href, label: value.label } : null;
  } catch {
    return null;
  }
}
function Answer({
  result,
  origin,
  siteId,
  onReference,
}: {
  result: unknown;
  origin: string;
  siteId: string;
  onReference: (id: string) => void;
}) {
  const value = record(result);
  if (
    typeof value.summary !== 'string' ||
    !['observations', 'possibleCauses', 'suggestions', 'limitations'].every(k =>
      Array.isArray(value[k]),
    )
  )
    return <AiNotice error>已完成任务的结果格式无法展示，请回查原任务。</AiNotice>;
  const refs = (input: unknown) =>
    Array.isArray(input)
      ? input.map((r, i) => {
          const ref = record(r);
          return typeof ref.contextId === 'string' && uuid.test(ref.contextId) ? (
            <AiButton
              key={`${ref.contextId}:${String(ref.factId)}:${i}`}
              onClick={() => onReference(String(ref.contextId))}
            >
              {ref.historical ? '历史依据' : '生成时依据'} · {String(ref.factId)}
            </AiButton>
          ) : null;
        })
      : null;
  const items = (key: string, title: string) =>
    (value[key] as unknown[]).length > 0 && (
      <section className={styles.answerSection}>
        <h3>{title}</h3>
        <ul>
          {(value[key] as unknown[]).map((input, i) => {
            const item = record(input);
            return typeof item.text === 'string' ? (
              <li key={i}>
                <p>{item.text}</p>
                <div className={styles.references}>{refs(item.refs)}</div>
              </li>
            ) : null;
          })}
        </ul>
      </section>
    );
  return (
    <div className={styles.answer}>
      <span className={`${styles.badge} ${origin === 'local' ? styles.neutral : ''}`}>
        {origin === 'local'
          ? '本地规则指引 · 未调用模型'
          : origin === 'provider'
            ? 'AI 分析 · 已校验'
            : '来源未知'}
      </span>
      <p className={styles.answerSummary}>{value.summary}</p>
      {Array.isArray(value.metrics) && (
        <div className={styles.metrics}>
          {value.metrics.map((input, i) => {
            const metric = record(input);
            return (
              <div key={i}>
                <small>{typeof metric.label === 'string' ? metric.label : '统计指标'}</small>
                <strong>
                  {typeof metric.value === 'number' ? metric.value.toLocaleString('zh-CN') : '未知'}
                </strong>
                <small>{dataStateLabel(metric.state)}</small>
              </div>
            );
          })}
        </div>
      )}
      {items('observations', '观察结果')}
      {items('possibleCauses', '可能原因，尚待验证')}
      {items('suggestions', '建议行动')}
      <section className={styles.answerSection}>
        <h3>限制与范围</h3>
        <ul>
          {(value.limitations as unknown[]).map((text, i) =>
            typeof text === 'string' ? <li key={i}>{text}</li> : null,
          )}
        </ul>
      </section>
      {typeof value.contextId === 'string' && uuid.test(value.contextId) && (
        <AiButton onClick={() => onReference(String(value.contextId))}>查看生成时依据</AiButton>
      )}
      {Array.isArray(value.actions) && (
        <div className={styles.actions}>
          {value.actions.map((input, i) => {
            const action = safeAction(input, siteId);
            return action ? (
              <a className={styles.button} key={i} href={action.href}>
                {action.label}
              </a>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
function ContextSnapshot({
  conversationId,
  contextId,
  onClose,
}: {
  conversationId: string;
  contextId: string;
  onClose: () => void;
}) {
  const c = useFeature(),
    snapshot = useQuery({
      queryKey: ['liekan-ai', c.user.id, 'context', conversationId, contextId],
      queryFn: ({ signal }) => aiClient.context(conversationId, contextId, signal),
      retry: false,
    });
  const facts = snapshot.data?.facts,
    extra = record(facts),
    budget = record(extra.inputBudget),
    clipping = record(budget.trimmed),
    model = record(extra.modelConfiguration);
  return (
    <AiModal title="生成时依据" onClose={onClose} wide>
      <div className={styles.modalBody}>
        {snapshot.isPending ? (
          <AiNotice>正在读取本次生成保存的统计快照…</AiNotice>
        ) : snapshot.error ? (
          <>
            <AiNotice error>{aiError(snapshot.error)}</AiNotice>
            <AiButton onClick={() => void snapshot.refetch()}>重新读取依据</AiButton>
          </>
        ) : facts ? (
          <>
            <dl className={styles.summary}>
              <dt>网站</dt>
              <dd>{facts.website.name}</dd>
              <dt>生成时间</dt>
              <dd>
                {new Date(facts.generatedAt).toLocaleString('zh-CN', { timeZone: facts.timeZone })}
              </dd>
              <dt>统计期间</dt>
              <dd>
                {new Date(facts.currentRange.startAt).toLocaleString('zh-CN', {
                  timeZone: facts.timeZone,
                })}{' '}
                至{' '}
                {new Date(facts.currentRange.endAt).toLocaleString('zh-CN', {
                  timeZone: facts.timeZone,
                })}
              </dd>
              <dt>时区</dt>
              <dd>{facts.timeZone}</dd>
              <dt>日志覆盖</dt>
              <dd>未经验证</dd>
              <dt>输入裁剪</dt>
              <dd>
                {typeof clipping.historyTurns === 'number' &&
                typeof clipping.logSamples === 'number' &&
                typeof clipping.topRows === 'number'
                  ? `历史轮次 ${clipping.historyTurns} · 日志样本 ${clipping.logSamples} · 排名记录 ${clipping.topRows}`
                  : '裁剪状态未记录'}
              </dd>
              {typeof model.model === 'string' && (
                <>
                  <dt>分析模型</dt>
                  <dd>
                    {model.model} · 配置版本 {String(model.configVersion || '未知')}
                  </dd>
                </>
              )}
              <dt>快照到期</dt>
              <dd>
                {new Date(snapshot.data.expiresAt).toLocaleString('zh-CN', {
                  timeZone: facts.timeZone,
                })}
              </dd>
            </dl>
            <AiNotice>
              这里展示生成时保存的依据。当前统计页会随新数据变化。
              {facts.rangeNotes.currentDayIncomplete ? '当前日期数据尚未完整。' : ''}
              {facts.rangeNotes.endClamped ? '结束时间已收束到生成时刻。' : ''}
            </AiNotice>
            {Object.entries(facts.sourceStates).map(([source, state]) => (
              <span key={source} className={styles.badge}>
                {sourceLabel(source)} · {dataStateLabel(state)}
              </span>
            ))}
            <div className={styles.factList}>
              {facts.facts.map(fact => (
                <details key={fact.id}>
                  <summary>
                    {fact.label} · {dataStateLabel(fact.state)}
                  </summary>
                  <pre>{JSON.stringify(fact.data, null, 2)}</pre>
                </details>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className={styles.modalFooter}>
        <AiButton onClick={onClose}>关闭依据</AiButton>
      </div>
    </AiModal>
  );
}
