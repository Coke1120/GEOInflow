'use client';
import { Check, Copy, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AiRun } from '@/lib/liekan/upstream/ai-client';
import home from '@/styles/liekan/AiChatHome.module.css';
import { aiError, RunStatus } from './AiShared';

export function ChatAssistantHeading({ state }: { state?: string }) {
  return (
    <div className={home.assistantHeading}>
      <span className={home.assistantMark}>
        <Sparkles size={16} aria-hidden="true" />
      </span>
      <span>猎看分析</span>
      {state && <RunStatus state={state} />}
    </div>
  );
}

// Show only a provisional summary, never interpret model markup or expose its reasoning.
export function chatPreviewSummary(preview: string) {
  if (preview.trimStart().startsWith('```') || preview.trimStart().startsWith('[')) return '';
  if (!preview.trimStart().startsWith('{')) return preview;
  const match = preview.match(/"summary"\s*:\s*"((?:[^"\\]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*)/);
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return '';
  }
}

export function ChatActivity({
  stage,
  busy,
  preview,
  error,
}: {
  stage: string;
  busy: boolean;
  preview: string;
  error?: string;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const summary = chatPreviewSummary(preview);
  const label =
    stage === 'validating'
      ? '正在核对统计依据与回答'
      : stage === 'calling'
        ? '正在分析网站数据'
        : '正在读取统计依据';
  const stopped = stage === 'cancelled',
    stopping = stage === 'cancel_requested';
  return (
    <div className={home.activity} aria-busy={busy}>
      {busy ? (
        <>
          <div className={home.activityLine} role="status">
            <span className={home.activityDots} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{label}</span>
            <span className={home.elapsed}>{elapsed} 秒</span>
          </div>
          {summary ? (
            <p className={home.streamSummary}>{summary}</p>
          ) : (
            <p className={home.activityHint}>
              {elapsed >= 20
                ? '模型响应时间较长，你可以继续等待或停止本次分析。'
                : '回答生成后会核对数据与页面入口，可随时停止。'}
            </p>
          )}
          {summary && <span className={home.previewLabel}>生成中，内容待核验</span>}
        </>
      ) : (
        <div className={home.failure} role={error ? 'alert' : 'status'}>
          <strong>{stopping ? '正在停止分析' : stopped ? '分析已停止' : '本次分析未完成'}</strong>
          <p>
            {error ||
              (stopping
                ? '取消请求已提交，正在等待服务端确认。'
                : stopped
                  ? '你可以修改问题后继续提问。'
                  : '请回查原任务，确认结果后再继续。')}
          </p>
          {summary && (
            <details>
              <summary>查看未完成的预览</summary>
              <div className={home.rawPreview}>{summary}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatRunDetails({ run }: { run: AiRun | null }) {
  if (!run) return null;
  return (
    <details className={home.runDetails}>
      <summary>
        运行详情{run.latencyMs != null ? ` · ${(run.latencyMs / 1000).toFixed(1)} 秒` : ''}
      </summary>
      <dl>
        <div>
          <dt>首字耗时</dt>
          <dd>{run.ttftMs != null ? `${run.ttftMs} ms` : '未记录'}</dd>
        </div>
        <div>
          <dt>总耗时</dt>
          <dd>{run.latencyMs != null ? `${run.latencyMs} ms` : '未记录'}</dd>
        </div>
        <div>
          <dt>Token 用量</dt>
          <dd>{run.usage?.totalTokens ?? '供应商未返回'}</dd>
        </div>
      </dl>
      {run.error && <p>{aiError(run.error)}</p>}
    </details>
  );
}

export function ChatCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <button
        type="button"
        className={home.copyButton}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {copied ? '已复制' : '复制回答'}
      </button>
      {failed && <span role="status">复制未完成，请选中回答后复制。</span>}
    </>
  );
}
