'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { Check, Copy, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AiRun } from '@/lib/liekan/upstream/ai-client';
import home from '@/styles/liekan/AiChatHome.module.css';
import { aiError, RunStatus } from './AiShared';

export function ChatAssistantHeading({ state }: { state?: string }) {
  const i18n = useLiekanI18n();
  return (
    <div className={home.assistantHeading}>
      <span className={home.assistantMark}>
        <Sparkles size={16} aria-hidden="true" />
      </span>
      <span>{i18n.text('猎看分析')}</span>
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
  const i18n = useLiekanI18n();
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
            <span>{i18n.system(label)}</span>
            <span className={home.elapsed}>
              {elapsed}
              {i18n.fragment(' 秒', true, false)}
            </span>
          </div>
          {summary ? (
            <p className={home.streamSummary}>{summary}</p>
          ) : (
            <p className={home.activityHint}>
              {elapsed >= 20
                ? i18n.text('模型响应时间较长，你可以继续等待或停止本次分析。')
                : i18n.text('回答生成后会核对数据与页面入口，可随时停止。')}
            </p>
          )}
          {summary && <span className={home.previewLabel}>{i18n.text('生成中，内容待核验')}</span>}
        </>
      ) : (
        <div className={home.failure} role={error ? 'alert' : 'status'}>
          <strong>
            {stopping
              ? i18n.text('正在停止分析')
              : stopped
                ? i18n.text('分析已停止')
                : i18n.text('本次分析未完成')}
          </strong>
          <p>
            {error ||
              (stopping
                ? i18n.text('取消请求已提交，正在等待服务端确认。')
                : stopped
                  ? i18n.text('你可以修改问题后继续提问。')
                  : i18n.text('请回查原任务，确认结果后再继续。'))}
          </p>
          {summary && (
            <details>
              <summary>{i18n.text('查看未完成的预览')}</summary>
              <div className={home.rawPreview}>{summary}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatRunDetails({ run }: { run: AiRun | null }) {
  const i18n = useLiekanI18n();
  if (!run) return null;
  return (
    <details className={home.runDetails}>
      <summary>
        {i18n.fragment('运行详情', false, true)}
        {run.latencyMs != null ? i18n.text(' · {v0} 秒', [(run.latencyMs / 1000).toFixed(1)]) : ''}
      </summary>
      <dl>
        <div>
          <dt>{i18n.text('首字耗时')}</dt>
          <dd>{run.ttftMs != null ? `${run.ttftMs} ms` : i18n.text('未记录')}</dd>
        </div>
        <div>
          <dt>{i18n.text('总耗时')}</dt>
          <dd>{run.latencyMs != null ? `${run.latencyMs} ms` : i18n.text('未记录')}</dd>
        </div>
        <div>
          <dt>{i18n.text('Token 用量')}</dt>
          <dd>{run.usage?.totalTokens ?? i18n.text('供应商未返回')}</dd>
        </div>
      </dl>
      {run.error && <p>{aiError(run.error)}</p>}
    </details>
  );
}

export function ChatCopy({ text }: { text: string }) {
  const i18n = useLiekanI18n();
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
        {copied ? i18n.text('已复制') : i18n.text('复制回答')}
      </button>
      {failed && <span role="status">{i18n.text('复制未完成，请选中回答后复制。')}</span>}
    </>
  );
}
