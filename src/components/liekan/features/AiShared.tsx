'use client';
import {
  useManualQuery as useQuery,
  useManualInfiniteQuery as useInfiniteQuery,
} from '@/lib/liekan/contracts/manual-refresh';

import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type AiCatalog,
  AiClientError,
  type AiConnection,
  type AiRun,
  aiClient,
  streamAiRun,
} from '@/lib/liekan/upstream/ai-client';
import styles from '@/styles/liekan/Ai.module.css';
import { useFeature } from './context';

export { styles };
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type AiSpaceOption = AiCatalog['spaces'][number];
export const activeRun = (run?: AiRun | null) =>
  !!run &&
  ['accepted', 'preparing', 'calling', 'validating', 'cancel_requested'].includes(run.state);
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
type ModelConfiguration = Pick<AiConnection, 'provider' | 'protocol' | 'baseUrl' | 'model'> & {
  contextWindow?: number;
  contextWindowSource?: 'application_limit' | 'provider_documented';
};
export function modelWindow(catalog: AiCatalog, configuration: ModelConfiguration) {
  if (
    typeof configuration.contextWindow === 'number' &&
    Number.isSafeInteger(configuration.contextWindow) &&
    configuration.contextWindow > 0
  ) {
    return {
      tokens: configuration.contextWindow,
      source:
        configuration.contextWindowSource === 'provider_documented' ? '供应商文档' : '应用限制估算',
    };
  }
  const endpoint = (value: string) => {
    try {
      return new URL(value).href;
    } catch {
      return '';
    }
  };
  const template = catalog.templates.find(
    t =>
      t.id !== 'custom' &&
      t.provider === configuration.provider &&
      t.protocol === configuration.protocol &&
      t.model === configuration.model &&
      !!endpoint(configuration.baseUrl) &&
      endpoint(t.baseUrl) === endpoint(configuration.baseUrl),
  );
  const matched =
    template && Number.isSafeInteger(template.contextWindow) && template.contextWindow > 0;
  return {
    tokens: matched ? template.contextWindow : 16384,
    source: matched
      ? record(template).contextWindowSource === 'provider_documented'
        ? '供应商文档'
        : record(template).contextWindowSource === 'application_limit'
          ? '应用限制估算'
          : '匹配模型模板的应用预算'
      : '应用保守估算',
  };
}
export function ModelWindow({
  catalog,
  configuration,
}: {
  catalog: AiCatalog;
  configuration: ModelConfiguration;
}) {
  const window = modelWindow(catalog, configuration);
  return (
    <>
      {window.tokens.toLocaleString('en-US')} Token · 来源：{window.source}
    </>
  );
}
export function aiError(error: unknown) {
  const e = record(error);
  const status = e.status;
  if (status === 401) return '需要重新登录后继续。';
  if (status === 403) return '当前账户没有执行此操作的权限。';
  if (status === 404) return '资源或生成时依据不可访问、已到期或已清理，请刷新或新建对话。';
  if (status === 409 || e.code === 'conflict') return '配置或网站归属已更新，请刷新后重试。';
  if (status === 429) return '请求频率或每日额度已达上限，请稍后重试。';
  const messages: Record<string, string> = {
    key_required: '供应商、协议、工作空间或接口域名已变更，请重新填写 API Key。',
    credentials: 'AI 凭证或模型权限无效，请检查后重试。',
    model: '模型或接口暂不可用，请检查配置。',
    busy: 'AI 服务繁忙或额度不足，请稍后重试。',
    timeout: 'AI 请求超时，请稍后重试。',
    network: '无法连接 AI 服务，请稍后重试。',
    protocol: 'AI 服务响应格式不受支持。',
    oversize: 'AI 请求或响应超过允许大小。',
    input_budget: '问题与统计依据超过模型输入预算，请缩短问题或缩小日期范围后重试。',
    empty_output: '收到响应，模型未返回可用文本。请检查生成预算和模型配置。',
    truncated_output: '模型文本被截断，本次结果未保存。请缩短问题或调整模型。',
    refused_output: '模型拒绝了本次请求，本次结果未保存。请调整问题后重试。',
    test_incomplete: '收到响应，文本测试未完成。请检查模型输出后重新测试。',
    cancelled: 'AI 请求已取消。',
    invalidated: 'AI 配置已变更，本次结果已失效。',
    interrupted: 'AI 任务已中断，请重新发起。',
    stream_incomplete: '连接已中断，可回查原任务。重新发起将创建新请求。',
    facts_timeout: '读取统计事实超时，请缩小日期范围后重试。',
    facts_unavailable: '统计数据暂时不可读取，请稍后重试。',
  };
  return messages[String(e.code)] || 'AI 请求暂时无法完成，请刷新后重试。';
}
export function AiButton({
  primary,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={`${styles.button} ${primary ? styles.primary : ''}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function AiNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`${styles.notice} ${error ? styles.error : ''}`}
    >
      {children}
    </div>
  );
}
export function useAiCatalog(selectedWebsiteId?: string) {
  const c = useFeature();
  const query = useInfiniteQuery({
    queryKey: ['liekan-ai', c.user.id, 'catalog'],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => aiClient.catalog(signal, { offset: pageParam }),
    getNextPageParam: page => page.nextOffset ?? undefined,
    retry: false,
  });
  const pages = query.data?.pages ?? [];
  const requestedId = selectedWebsiteId ?? c.query.aiSite;
  const remembered = useRef<AiCatalog>(null);
  const selectedPage = pages.find(page => page.websites.some(site => site.id === requestedId));
  if (selectedPage)
    remembered.current = {
      ...selectedPage,
      websites: selectedPage.websites.filter(site => site.id === requestedId),
    };
  const needsSelected =
    pages.length > 0 &&
    !!requestedId &&
    uuid.test(requestedId) &&
    !pages.some(page => page.websites.some(site => site.id === requestedId));
  const selected = useQuery({
    queryKey: ['liekan-ai', c.user.id, 'catalog-selected', requestedId || ''],
    queryFn: ({ signal }) => aiClient.catalog(signal, { websiteId: requestedId }),
    enabled: needsSelected,
    retry: false,
  });
  const retainedSelection =
    pages.length > 0 &&
    needsSelected &&
    !selected.data &&
    ![401, 403, 404].includes((selected.error as any)?.status) &&
    remembered.current?.websites.some(site => site.id === requestedId)
      ? remembered.current
      : undefined;
  const all =
    needsSelected && (selected.data || retainedSelection)
      ? [...pages, selected.data || retainedSelection]
      : pages;
  const data = all.length
    ? {
        ...all[0],
        spaces: [
          ...new Map(
            all.flatMap(page => page.spaces).map(space => [`${space.kind}:${space.id}`, space]),
          ).values(),
        ],
        websites: [
          ...new Map(all.flatMap(page => page.websites).map(site => [site.id, site])).values(),
        ],
      }
    : undefined;
  return {
    ...query,
    data,
    isPending: query.isPending || (needsSelected && selected.isPending && !retainedSelection),
    error: query.error || (needsSelected ? selected.error : null),
    refetch: () => Promise.all([query.refetch(), ...(needsSelected ? [selected.refetch()] : [])]),
  };
}
export function AiCatalogMore({ query }: { query: ReturnType<typeof useAiCatalog> }) {
  if (!query.hasNextPage) return null;
  return (
    <>
      {query.isFetchNextPageError && <AiNotice error>更多网站与空间暂未读取，请重试。</AiNotice>}
      <AiButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
        {query.isFetchingNextPage ? '正在读取更多网站与空间…' : '加载更多网站与空间'}
      </AiButton>
    </>
  );
}
export function ModuleNotice({ catalog }: { catalog: AiCatalog }) {
  if (catalog.module.enabled) return null;
  const reason: Record<string, string> = {
    feature_disabled: '实例尚未启用 AI 能力。',
    encryption_key_missing: '实例尚未配置 AI 密钥加密环境。',
    encryption_key_invalid: '实例的 AI 密钥加密配置无效。',
  };
  return (
    <AiNotice>
      {reason[catalog.module.reason || ''] || '实例的 AI 能力暂不可用。'} 请联系实例管理员完成配置。
    </AiNotice>
  );
}
export function AiModal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void | Promise<void>;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose),
    label = useId();
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
        ) || [],
      );
    (focusables()[0] || ref.current)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void close.current();
      }
      if (event.key === 'Tab') {
        const items = focusables(),
          first = items[0],
          last = items.at(-1);
        if (!first) {
          event.preventDefault();
          ref.current?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div
      className={styles.backdrop}
      onClick={e => {
        if (e.target === e.currentTarget) void onClose();
      }}
    >
      <div
        ref={ref}
        className={`${styles.modal} ${wide ? styles.wide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label}
        tabIndex={-1}
        lang="zh-CN"
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id={label}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <AiButton aria-label={`关闭${title}`} onClick={() => void onClose()}>
            ×
          </AiButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
type RunMetadata = {
  clientRequestId: string;
  runId?: string;
  siteId?: string;
  conversationId?: string;
};
function stored(key: string): RunMetadata | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return value &&
      uuid.test(value.clientRequestId) &&
      ['runId', 'siteId', 'conversationId'].every(
        k => value[k] === undefined || uuid.test(value[k]),
      )
      ? {
          clientRequestId: value.clientRequestId,
          ...(value.runId ? { runId: value.runId } : {}),
          ...(value.siteId ? { siteId: value.siteId } : {}),
          ...(value.conversationId ? { conversationId: value.conversationId } : {}),
        }
      : null;
  } catch {
    return null;
  }
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const eventLabels: Record<string, string> = {
  submitting: '已发起请求，等待服务端确认',
  accepted: '请求已接受',
  preparing: '配置检查',
  calling: '发送请求',
  first_text: '首次文本可展示',
  validating: '接收完成，正在校验',
  completed: '接收完成并通过校验',
  cancel_requested: '取消请求已保存',
  cancelled: '任务已取消',
  failed: '任务未完成',
  interrupted: '任务已中断',
  invalidated: '结果已失效',
};
type RunEventLog = { stage: string; label: string; timestamp: string };
/** Persist safe request identifiers only. Recovery never creates a model request. */
export function useAiRun(key: string, onFinished?: (run: AiRun) => void) {
  const [run, setRun] = useState<AiRun | null>(null),
    [preview, setPreview] = useState(''),
    [stage, setStage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [recoverable, setRecoverable] = useState(false),
    [eventLogs, setEventLogs] = useState<RunEventLog[]>([]);
  const mounted = useRef(true),
    controller = useRef<AbortController | null>(null),
    metadata = useRef<RunMetadata | null>(null),
    runRef = useRef<AiRun | null>(null),
    generation = useRef(0),
    finish = useRef(onFinished),
    stopPromise = useRef<{ generation: number; promise: Promise<boolean> } | null>(null),
    keyRef = useRef(key);
  finish.current = onFinished;
  keyRef.current = key;
  const save = (m: RunMetadata) => {
    metadata.current = m;
    try {
      sessionStorage.setItem(keyRef.current, JSON.stringify(m));
    } catch {}
  };
  const logStage = (value: string) => {
    if (!Object.hasOwn(eventLabels, value)) return;
    const entry = { stage: value, label: eventLabels[value], timestamp: new Date().toISOString() };
    setEventLogs(logs => [...logs.slice(-63), entry]);
  };
  const accept = (value: AiRun, g: number) => {
    if (!mounted.current || generation.current !== g) return;
    if (runRef.current?.state !== value.state) logStage(value.state);
    runRef.current = value;
    setRun(value);
    setStage(value.state);
    setBusy(activeRun(value));
    setRecoverable(activeRun(value));
    if (metadata.current) save({ ...metadata.current, runId: value.id });
    if (!activeRun(value)) {
      try {
        sessionStorage.removeItem(keyRef.current);
      } catch {}
      setRecoverable(false);
      controller.current = null;
      finish.current?.(value);
    }
  };
  const poll = async (value: AiRun, g: number, signal: AbortSignal) => {
    if (signal.aborted || generation.current !== g) return;
    let current = value;
    accept(current, g);
    for (let i = 0; activeRun(current) && i < 12 && !signal.aborted; i++) {
      await delay(1000);
      if (signal.aborted || generation.current !== g) return;
      current = await aiClient.run(current.id, signal);
      accept(current, g);
    }
    if (activeRun(current) && mounted.current && g === generation.current) {
      setBusy(false);
      setRecoverable(true);
      setError('任务仍在执行，可回查原任务。');
    }
  };
  const recover = async () => {
    const m = metadata.current || stored(keyRef.current);
    if (!m || busy) return;
    metadata.current = m;
    const g = ++generation.current,
      ctrl = new AbortController();
    controller.current = ctrl;
    setBusy(true);
    setError('');
    try {
      const value = m.runId
        ? await aiClient.run(m.runId, ctrl.signal)
        : await aiClient.findRun(m.clientRequestId, ctrl.signal);
      await poll(value, g, ctrl.signal);
    } catch (e) {
      if (mounted.current && g === generation.current && !ctrl.signal.aborted) {
        setError(aiError(e));
        setBusy(false);
        const unavailable = record(e).status === 404;
        setRecoverable(!unavailable);
        if (unavailable) {
          metadata.current = null;
          setStage('failed');
          controller.current = null;
          try {
            sessionStorage.removeItem(keyRef.current);
          } catch {}
        }
      }
    }
  };
  const start = async (
    path: string,
    body: Record<string, unknown>,
    ids: Pick<RunMetadata, 'siteId' | 'conversationId'> = {},
  ) => {
    if (
      !mounted.current ||
      busy ||
      activeRun(runRef.current) ||
      (controller.current && !controller.current.signal.aborted && metadata.current)
    )
      return;
    const g = ++generation.current,
      ctrl = new AbortController();
    controller.current = ctrl;
    runRef.current = null;
    setRun(null);
    setPreview('');
    setError('');
    setStage('submitting');
    setEventLogs([]);
    logStage('submitting');
    setBusy(true);
    setRecoverable(false);
    const m = { clientRequestId: crypto.randomUUID(), ...ids };
    save(m);
    try {
      const value = await streamAiRun(
        path,
        { ...body, clientRequestId: m.clientRequestId },
        ctrl.signal,
        event => {
          if (!mounted.current || generation.current !== g || ctrl.signal.aborted) return;
          save({ ...metadata.current, clientRequestId: m.clientRequestId, runId: event.runId });
          const data = record(event.data);
          if (event.type === 'started') {
            setStage('accepted');
            logStage('accepted');
          }
          if (
            event.type === 'stage' &&
            typeof data.stage === 'string' &&
            Object.hasOwn(eventLabels, data.stage)
          ) {
            setStage(data.stage);
            logStage(data.stage);
          }
          if (event.type === 'delta' && typeof data.text === 'string')
            setPreview(p => p + data.text);
          if (event.type === 'done') accept(event.data as AiRun, g);
          if (
            event.type === 'error' &&
            typeof data.state === 'string' &&
            ['failed', 'cancelled', 'interrupted', 'invalidated'].includes(data.state)
          ) {
            setStage(data.state);
            logStage(data.state);
            setError(aiError(data));
            setBusy(false);
            setRecoverable(true);
          }
        },
      );
      await poll(value, g, ctrl.signal);
    } catch (e) {
      if (mounted.current && generation.current === g && !ctrl.signal.aborted) {
        if (e instanceof AiClientError && e.runId) {
          save({ ...m, runId: e.runId });
          // Reconcile a persisted failure immediately; this GET never creates a supplier call.
          try {
            const persisted = await aiClient.run(e.runId, ctrl.signal);
            if (!mounted.current || generation.current !== g || ctrl.signal.aborted) return;
            if (!activeRun(persisted)) {
              accept(persisted, g);
              setError(persisted.error ? aiError(persisted.error) : '');
              return;
            }
          } catch {
            /* An unavailable status remains recoverable. */
          }
        }
        if (!mounted.current || generation.current !== g || ctrl.signal.aborted) return;
        setError(aiError(e));
        setBusy(false);
        const rejected =
          !metadata.current?.runId &&
          [400, 401, 403, 404, 409, 413, 429].includes(Number(record(e).status));
        setRecoverable(!rejected);
        if (rejected) {
          metadata.current = null;
          setStage('failed');
          logStage('failed');
          try {
            sessionStorage.removeItem(keyRef.current);
          } catch {}
        }
      }
    } finally {
      if (generation.current === g && !activeRun(runRef.current)) controller.current = null;
    }
  };
  const stop = useCallback(async () => {
    const g = generation.current;
    if (stopPromise.current?.generation === g) return stopPromise.current.promise;
    const operation = (async () => {
      if (controller.current?.signal.aborted) return true;
      const m = metadata.current,
        storageKey = keyRef.current,
        cancelledController = controller.current;
      if (!m || (runRef.current && !activeRun(runRef.current))) {
        controller.current?.abort();
        return true;
      }
      try {
        let id = m.runId;
        if (!id) {
          let found: AiRun | undefined;
          for (let i = 0; i < 3 && !found; i++) {
            try {
              found = await aiClient.findRun(m.clientRequestId);
            } catch (e) {
              if (i === 2) throw e;
              await delay(200);
            }
          }
          id = found?.id;
        }
        if (!id) throw new Error('unknown');
        const saved = await aiClient.cancel(id);
        cancelledController?.abort();
        const current =
          generation.current === g && metadata.current?.clientRequestId === m.clientRequestId;
        if (mounted.current && current) {
          runRef.current = saved;
          setRun(saved);
          setStage(saved.state);
          logStage(saved.state);
          setBusy(false);
          setRecoverable(activeRun(saved));
          setError(activeRun(saved) ? '取消请求已保存，正在等待服务端停止。可回查原任务。' : '');
        }
        if (!activeRun(saved)) {
          try {
            if (stored(storageKey)?.clientRequestId === m.clientRequestId)
              sessionStorage.removeItem(storageKey);
          } catch {}
          if (current) metadata.current = null;
        }
        return current;
      } catch {
        if (mounted.current && generation.current === g) {
          setError('取消请求未确认，任务可能仍在执行。请回查原任务。');
          setRecoverable(true);
        }
        return false;
      }
    })();
    stopPromise.current = { generation: g, promise: operation };
    try {
      return await operation;
    } finally {
      if (stopPromise.current?.promise === operation) stopPromise.current = null;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    metadata.current = stored(key);
    runRef.current = null;
    setRun(null);
    setPreview('');
    setStage('');
    setEventLogs([]);
    setError('');
    setBusy(false);
    setRecoverable(!!metadata.current);
    if (metadata.current) void recover();
    return () => {
      mounted.current = false;
      generation.current++;
      void stop();
    };
  }, [key, stop]);
  const reset = () => {
    if (!controller.current?.signal.aborted && (activeRun(runRef.current) || busy)) return false;
    generation.current++;
    metadata.current = null;
    controller.current = null;
    runRef.current = null;
    setRun(null);
    setPreview('');
    setStage('');
    setEventLogs([]);
    setError('');
    setRecoverable(false);
    try {
      sessionStorage.removeItem(keyRef.current);
    } catch {}
    return true;
  };
  return {
    run,
    preview,
    eventLogs,
    stage,
    error,
    busy,
    recoverable,
    start,
    stop,
    recover,
    reset,
    metadata: metadata.current,
  };
}
const stageLabels: Record<string, string> = {
  submitting: '等待接受请求',
  accepted: '请求已接受',
  preparing: '准备统计依据',
  calling: '调用模型',
  first_text: '首次文本已返回',
  validating: '校验结果',
  cancel_requested: '等待取消',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
  interrupted: '已中断',
  invalidated: '结果已失效',
};
export function RunStatus({ state }: { state: string }) {
  return (
    <span role="status" aria-live="polite" data-ai-run-state={state} className={styles.badge}>
      {stageLabels[state] || '准备开始'}
    </span>
  );
}
export function RunMetrics({ run }: { run: AiRun | null }) {
  return (
    <div className={styles.runMetrics}>
      <div>
        <small>首字耗时</small>
        <strong>
          {run?.ttftMs != null ? `${run.ttftMs} ms` : run && !activeRun(run) ? '不适用' : '等待'}
        </strong>
      </div>
      <div>
        <small>总耗时</small>
        <strong>{run?.latencyMs != null ? `${run.latencyMs} ms` : '未知'}</strong>
      </div>
      <div>
        <small>Token 用量</small>
        <strong>{run?.usage?.totalTokens ?? '未知'}</strong>
      </div>
    </div>
  );
}
