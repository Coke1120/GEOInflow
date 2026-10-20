'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import {
  ArrowUp,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Globe2,
  Layers3,
  Link2,
  ListFilter,
  Map,
  MessageSquare,
  Target,
  Square,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef } from 'react';
import type { AiCatalog } from '@/lib/liekan/upstream/ai-client';
import home from '@/styles/liekan/AiChatHome.module.css';
import { useFeature } from './context';

export function ChatWelcome() {
  const i18n = useLiekanI18n();
  return (
    <div className={home.welcome} data-ai-welcome>
      <h2>{i18n.text('今天想问什么，GEOInflow 团队？')}</h2>
      <p>{i18n.text('问指标、查趋势、排查网站表现，回答后可直达相关页面')}</p>
    </div>
  );
}

export function ChatWebsite({
  websites,
  value,
  onChange,
  disabled,
}: {
  websites: AiCatalog['websites'];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const i18n = useLiekanI18n();
  return (
    <label className={home.website}>
      <Globe2 size={16} aria-hidden="true" />
      <select
        data-ai-site-selector
        aria-label={i18n.text('分析网站')}
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">{i18n.text('选择网站')}</option>
        {websites.map(site => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}

export function ChatComposer({
  question,
  onQuestion,
  onSubmit,
  scope,
  disabled,
  submitDisabled,
  busy,
  onStop,
  disclosure,
  maxLength,
  compact = false,
}: {
  question: string;
  onQuestion: (text: string) => void;
  onSubmit: (event: FormEvent) => void;
  scope: ReactNode;
  disabled?: boolean;
  submitDisabled?: boolean;
  busy?: boolean;
  onStop?: () => void;
  disclosure?: ReactNode;
  maxLength: number;
  compact?: boolean;
}) {
  const i18n = useLiekanI18n();
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    if (!compact) {
      input.current.style.removeProperty('height');
      return;
    }
    input.current.style.height = `${Math.min(180, input.current.scrollHeight)}px`;
  }, [question, compact]);
  return (
    <>
      <form
        onSubmit={onSubmit}
        className={`${home.composer} ${compact ? home.compactComposer : ''}`}
      >
        <textarea
          ref={input}
          rows={compact ? 1 : 3}
          data-ai-question
          aria-label={i18n.text('分析问题')}
          value={question}
          maxLength={maxLength}
          placeholder={i18n.system(
            compact
              ? i18n.text('继续提问，或补充你想分析的细节…')
              : i18n.text('例如：本周 AI 抓取为什么下降？哪些页面值得优先优化？'),
          )}
          disabled={disabled}
          onChange={event => onQuestion(event.target.value)}
          onKeyDown={event => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className={home.composerActions}>
          <div className={home.composerScope}>{scope}</div>
          {busy ? (
            <button
              type="button"
              className={`${home.send} ${home.stop}`}
              onClick={onStop}
              aria-label={i18n.text('停止分析')}
              title={i18n.text('停止分析')}
            >
              <Square size={13} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              className={home.send}
              aria-label={i18n.text('发起分析')}
              title={i18n.text('Enter 发送，Shift + Enter 换行')}
              disabled={disabled || submitDisabled}
            >
              <ArrowUp size={21} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
      {disclosure}
    </>
  );
}

const functions = [
  { title: 'AI 抓取分析', page: 'geo-ai', icon: ChartNoAxesCombined },
  { title: '来源渠道', page: 'geo-sources', icon: Link2 },
  { title: '地域地图', page: 'geo-geography', icon: Map },
  { title: '页面事件', page: 'geo-content', icon: Layers3 },
  { title: '转化分析', page: 'geo-conversions', icon: Target },
  { title: '日志监测', page: 'geo-logs', icon: ListFilter },
];
const prompts = [
  '分析最近 7 天的 AI 抓取趋势',
  '哪些页面值得优先优化？',
  '检查 AI 来源与转化表现',
  '访客主要来自哪些地区？',
];
export function ChatHome({
  siteId,
  onPrompt,
  onChooseSite,
  onHistory,
  disabled,
  range,
}: {
  siteId?: string;
  onPrompt: (text: string) => void;
  onChooseSite: () => void;
  onHistory?: () => void;
  disabled?: boolean;
  range?: { startAt: number; endAt: number; timezone: string };
}) {
  const i18n = useLiekanI18n();
  const c = useFeature();
  const validRange =
    !range ||
    (Number.isFinite(range.startAt) &&
      Number.isFinite(range.endAt) &&
      range.endAt >= range.startAt &&
      range.startAt >= 0);
  const dates =
    range && validRange
      ? {
          date: `range:${range.startAt}:${range.endAt}`,
          unit: 'day',
          timezone: range.timezone,
          live: '0',
        }
      : {};
  return (
    <div className={home.home}>
      <section aria-labelledby="ai-functions-title">
        <div className={home.sectionHeading}>
          <h3 id="ai-functions-title">{i18n.text('常用功能')}</h3>
          <span>{i18n.text('常用功能可直接进入对应页面')}</span>
        </div>
        <div className={home.functionGrid}>
          {functions.map(({ title, page, icon: Icon }) => {
            const content = (
              <>
                <Icon size={16} aria-hidden="true" />
                <span>{i18n.system(title)}</span>
              </>
            );
            return siteId && validRange ? (
              <a
                key={page}
                className={home.function}
                href={c.href(page, { websiteId: siteId, ...dates })}
              >
                {content}
              </a>
            ) : (
              <button key={page} type="button" className={home.function} onClick={onChooseSite}>
                {content}
              </button>
            );
          })}
        </div>
      </section>
      <section className={home.toolZone} aria-label={i18n.text('分析与数据指引')}>
        <div>
          <h3>
            {i18n.fragment('GEO 工具一站直达 ', false, true)}
            <ChevronRight size={14} aria-hidden="true" />
          </h3>
          <p>{i18n.text('常用工具直接进入独立页面，操作中遇到问题可以随时问 AI 管家')}</p>
          <div className={home.toolLinks}>
            {[
              [i18n.text('网站管理'), 'websites'],
              [i18n.text('数据看板'), 'boards'],
              [i18n.text('追踪管理'), 'links'],
              [i18n.text('团队管理'), 'teams'],
            ].map(([label, page]) => (
              <a key={page} href={c.href(page)}>
                {i18n.system(label)}
              </a>
            ))}
            {siteId ? (
              <button type="button" disabled={disabled} onClick={onHistory}>
                {i18n.text('回答记录')}
              </button>
            ) : (
              <button type="button" disabled title={i18n.text('选择网站后可查看历史对话')}>
                {i18n.text('回答记录')}
              </button>
            )}
            {[
              [i18n.text('来源分析'), 'geo-sources'],
              [i18n.text('数据导出'), 'exports'],
            ].map(([label, page]) =>
              siteId && validRange ? (
                <a
                  key={page}
                  href={c.href(page, {
                    websiteId: siteId,
                    ...dates,
                    ...(page === 'exports' ? { from: 'stats' } : {}),
                  })}
                >
                  {i18n.system(label)}
                </a>
              ) : (
                <button key={page} type="button" onClick={onChooseSite}>
                  {i18n.system(label)}
                </button>
              ),
            )}
          </div>
        </div>
        <aside className={home.guide}>
          <h3>
            <span className={home.guideDot} aria-hidden="true" />
            {i18n.fragment('一次提问，清晰指引', true, false)}
          </h3>
          <div>
            <span>{i18n.text('理解问题')}</span>
            <span>{i18n.text('检索指标')}</span>
            <span>{i18n.text('定位页面')}</span>
            <span>{i18n.text('提供入口')}</span>
          </div>
        </aside>
      </section>
      <section className={home.questions} aria-labelledby="ai-questions-title">
        <div className={home.sectionHeading}>
          <h3 id="ai-questions-title">{i18n.text('试着这样问')}</h3>
          <span>{i18n.text('点击填入问题，随时补充细节')}</span>
        </div>
        <div className={home.questionGrid}>
          {prompts.map(text => (
            <button
              key={text}
              type="button"
              aria-label={i18n.system(text)}
              data-ai-suggested-question
              className={home.question}
              disabled={disabled}
              onClick={() => {
                onPrompt(i18n.system(text));
                document.querySelector<HTMLTextAreaElement>('textarea[data-ai-question]')?.focus();
              }}
            >
              <MessageSquare size={14} aria-hidden="true" />
              <span>{i18n.system(text)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
