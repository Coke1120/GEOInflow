'use client';
import {
  ArrowRight,
  ArrowUp,
  ChartNoAxesCombined,
  ChevronRight,
  Globe2,
  Layers3,
  Link2,
  ListFilter,
  Map,
  MessageSquare,
  Sparkles,
  Target,
} from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import type { AiCatalog } from '@/lib/liekan/upstream/ai-client';
import home from '@/styles/liekan/AiChatHome.module.css';
import { useFeature } from './context';

export function ChatWelcome() {
  return (
    <div className={home.welcome}>
      <h2>今天想问什么，猎看团队？</h2>
      <p>问指标、查趋势、定位异常，从数据中找到下一步</p>
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
  return (
    <label className={home.website}>
      <Globe2 size={16} aria-hidden="true" />
      <select
        aria-label="分析网站"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">选择网站</option>
        {websites.map(site => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
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
}) {
  return (
    <form onSubmit={onSubmit} className={home.composer}>
      <textarea
        aria-label="分析问题"
        value={question}
        maxLength={maxLength}
        placeholder="例如：本周 AI 抓取为什么下降？哪些页面值得优先优化？"
        disabled={disabled}
        onChange={event => onQuestion(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className={home.composerActions}>
        <div className={home.composerScope}>{scope}</div>
        {busy ? (
          <button type="button" className={home.stop} onClick={onStop}>
            停止分析
          </button>
        ) : (
          <button
            type="submit"
            className={home.send}
            aria-label="发起分析"
            title="发起分析，⌘ / Ctrl + Enter"
            disabled={disabled || submitDisabled}
          >
            <ArrowUp size={21} aria-hidden="true" />
          </button>
        )}
      </div>
      {disclosure}
    </form>
  );
}

const functions = [
  { title: 'AI 抓取分析', page: 'geo-ai', icon: ChartNoAxesCombined },
  { title: '来源渠道', page: 'geo-sources', icon: Link2 },
  { title: '地域地图', page: 'geo-geography', icon: Map },
  { title: '页面与事件', page: 'geo-content', icon: Layers3 },
  { title: '转化分析', page: 'geo-conversions', icon: Target },
  { title: '日志访问流', page: 'geo-logs', icon: ListFilter },
];
const prompts = [
  ['看趋势', '分析最近 7 天的 AI 抓取趋势'],
  ['找机会', '哪些页面值得优先优化？'],
  ['查来源', '检查 AI 来源与转化表现'],
  ['看地域', '访客主要来自哪些地区？'],
];
export function ChatHome({
  siteId,
  onPrompt,
  onChooseSite,
  disabled,
  range,
}: {
  siteId?: string;
  onPrompt: (text: string) => void;
  onChooseSite: () => void;
  disabled?: boolean;
  range?: { startAt: number; endAt: number; timezone: string };
}) {
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
          <h3 id="ai-functions-title">常用功能</h3>
          <span>{siteId ? '直接查看当前网站的统计' : '选择网站，直达相关数据'}</span>
        </div>
        <div className={home.functionGrid}>
          {functions.map(({ title, page, icon: Icon }) => {
            const content = (
              <>
                <Icon size={18} aria-hidden="true" />
                <span>{title}</span>
                <ChevronRight size={15} aria-hidden="true" />
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
      <section className={home.questions} aria-labelledby="ai-questions-title">
        <div className={home.sectionHeading}>
          <h3 id="ai-questions-title">试着这样问</h3>
          <span>点击填入问题，随时补充细节</span>
        </div>
        <div className={home.questionGrid}>
          {prompts.map(([label, text]) => (
            <button
              key={text}
              type="button"
              aria-label={text}
              className={home.question}
              disabled={disabled}
              onClick={() => {
                onPrompt(text);
                document
                  .querySelector<HTMLTextAreaElement>('textarea[aria-label="分析问题"]')
                  ?.focus();
              }}
            >
              <span className={home.questionLabel}>
                <MessageSquare size={14} aria-hidden="true" />
                {label}
              </span>
              <span>{text}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
      <section className={home.toolZone} aria-label="分析与数据指引">
        <div>
          <h3>
            数据工具，一站直达 <ChevronRight size={15} aria-hidden="true" />
          </h3>
          <p>管理网站与看板，遇到问题随时回来问 AI</p>
          <div className={home.toolLinks}>
            {[
              ['网站管理', 'websites'],
              ['数据看板', 'boards'],
              ['追踪管理', 'links'],
              ['帮助中心', 'help'],
            ].map(([label, page]) => (
              <a key={page} href={c.href(page)}>
                {label}
              </a>
            ))}
          </div>
        </div>
        <aside className={home.guide}>
          <h3>
            <Sparkles size={15} aria-hidden="true" />
            一次提问，清晰指引
          </h3>
          <div>
            <span>明确范围</span>
            <span>检索指标</span>
            <span>引用依据</span>
            <span>定位页面</span>
          </div>
        </aside>
      </section>
    </div>
  );
}
