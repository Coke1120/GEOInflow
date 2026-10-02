'use client';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/liekan/upstream/client';
import styles from '@/styles/liekan/Shell.module.css';
import { columns, downloadFile, formatMetricValue, formatValue, stateLabels } from './data';
import { ReportRows, SortHeading } from './ReportComponents';
import type { LiekanReport } from './types';

type Settings = { robots: string; allowlist: string[]; rules: unknown[] };
type ImportError = { line: number; reason: string };
type LogImportResult = {
  accepted: number;
  inserted: number;
  rejected: number;
  duplicate: boolean;
  errors: ImportError[];
};
export function ManagementDrawer({
  action,
  websiteId,
  canManage,
  onClose,
  onSaved,
  onSearch,
  onRange,
  report,
  onPage,
  onLogsFilter,
  isFetching,
  logsFilter,
  initialSearch,
  comparison,
}: {
  action: string;
  websiteId: string;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
  onSearch: (value: string) => void;
  onRange: (start: number, end: number) => void;
  report?: LiekanReport;
  onPage?: (page: number) => void;
  onLogsFilter?: (label: string) => void;
  isFetching?: boolean;
  logsFilter?: string;
  initialSearch?: string;
  comparison?: {
    current?: LiekanReport;
    previous?: LiekanReport;
    startAt: number;
    endAt: number;
    previousStartAt: number;
    previousEndAt: number;
    labels: string[];
    error?: unknown;
    fetching?: boolean;
    refetch?: () => void;
  };
}) {
  const api = useApi();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = 'liekan-drawer-title';
  const [content, setContent] = useState(action === '日志查询' ? initialSearch || '' : '');
  const [importMode, setImportMode] = useState(false);
  const [format, setFormat] = useState(action === 'sitemap 管理' ? 'sitemap' : 'combined');
  const [settings, setSettings] = useState<Settings>(null);
  const [status, setStatus] = useState('');
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [totalErrors, setTotalErrors] = useState(0);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const settingsAction = ['robots.txt 编辑', '蜘蛛白名单', '特征库管理', '解析规则'].includes(
    action,
  );
  const isCatalog = action === 'sitemap 管理';
  const isQuery = action === '日志查询' && !importMode;
  const isRange = action === '统计范围';
  const isComparison = action === '对比上周';
  const comparisonDate = (value: number) =>
    new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
      hour12: false,
    }).format(value);
  useEffect(() => {
    if (isQuery) setContent(initialSearch || '');
  }, [initialSearch, isQuery]);
  useEffect(() => {
    const original = document.activeElement as HTMLElement;
    panel.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,textarea,select',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (document.activeElement === panel.current) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      original?.focus();
    };
  }, [onClose]);
  useEffect(() => {
    if (!settingsAction) return;
    let alive = true;
    setBusy(true);
    api
      .get(`/liekan/websites/${websiteId}/settings`)
      .then((data: Settings) => {
        if (!alive) return;
        setSettings(data);
        setContent(
          action === 'robots.txt 编辑'
            ? data.robots
            : action === '蜘蛛白名单'
              ? data.allowlist.join('\n')
              : JSON.stringify(data.rules, null, 2),
        );
      })
      .catch(error => {
        if (alive) setStatus(error.message || '无法读取设置');
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [action, websiteId, settingsAction]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isComparison) return;
    if (isRange) {
      const startAt = new Date(`${start}T00:00:00+08:00`).getTime(),
        endAt = new Date(`${end}T23:59:59.999+08:00`).getTime();
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt > endAt) {
        setStatus('请选择有效的起止日期');
        return;
      }
      onRange(startAt, endAt);
      onClose();
      return;
    }
    if (isQuery) {
      onSearch(content);
      return;
    }
    if (!canManage) {
      setStatus('当前账号没有管理此站点的权限');
      return;
    }
    setBusy(true);
    setStatus('');
    setImportErrors([]);
    setTotalErrors(0);
    try {
      if (settingsAction) {
        if (!settings) throw new Error('请先读取设置');
        let patch: Partial<Settings>;
        if (action === 'robots.txt 编辑') patch = { robots: content };
        else if (action === '蜘蛛白名单')
          patch = {
            allowlist: content
              .split('\n')
              .map(value => value.trim())
              .filter(Boolean),
          };
        else {
          const rules = JSON.parse(content);
          if (!Array.isArray(rules)) throw new Error('规则须为 JSON 数组');
          patch = { rules };
        }
        const saved: Settings = await api.put(`/liekan/websites/${websiteId}/settings`, patch);
        setSettings(saved);
        setContent(
          action === 'robots.txt 编辑'
            ? saved.robots
            : action === '蜘蛛白名单'
              ? saved.allowlist.join('\n')
              : JSON.stringify(saved.rules, null, 2),
        );
        setStatus('已保存');
      } else if (isCatalog) {
        const result: { accepted: number; mode: string } = await api.put(
          `/liekan/websites/${websiteId}/catalog`,
          { format, content },
        );
        setStatus(
          `${result.mode === 'upsert' ? '已新增或更新' : '已导入'} ${formatValue(result.accepted)} 个页面`,
        );
      } else {
        const payload =
          format === 'json' ? { format, records: JSON.parse(content) } : { format, content };
        const result: LogImportResult = await api.post(
          `/liekan/websites/${websiteId}/logs/import`,
          payload,
        );
        const duplicate = result.accepted - result.inserted;
        setStatus(
          `校验通过 ${formatValue(result.accepted)} 条 · 新增 ${formatValue(result.inserted)} 条 · 重复 ${formatValue(duplicate)} 条 · 拒绝 ${formatValue(result.rejected)} 条${result.rejected > 0 ? '，部分记录未导入。' : result.duplicate ? '，该批次已导入。' : '。'}`,
        );
        setImportErrors(result.errors || []);
        setTotalErrors(result.rejected);
      }
      onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={styles.overlay}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
        tabIndex={-1}
      >
        <div className={styles.drawerHeader}>
          <h2 id={titleId} className={styles.drawerTitle}>
            {action}
          </h2>
          <button type="button" className={styles.close} aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <form className={styles.form} onSubmit={submit}>
          {action === '日志查询' && (
            <div className="flex gap-2">
              <button
                type="button"
                className={`chip${!importMode ? ' on' : ''}`}
                onClick={() => {
                  setImportMode(false);
                  setContent('');
                }}
              >
                查询记录
              </button>
              <button
                type="button"
                className={`chip${importMode ? ' on' : ''}`}
                onClick={() => {
                  setImportMode(true);
                  setContent('');
                }}
              >
                导入日志
              </button>
            </div>
          )}
          {isComparison ? (
            <div className={styles.form}>
              <p className={styles.help}>
                当前范围：{comparisonDate(comparison.startAt)} 至 {comparisonDate(comparison.endAt)}
              </p>
              <p className={styles.help}>
                上周范围：{comparisonDate(comparison.previousStartAt)} 至{' '}
                {comparisonDate(comparison.previousEndAt)}（整体前移 7 天）
              </p>
              {comparison.current?.cards
                .filter(
                  card => comparison.labels.includes(card.label) && !card.label.startsWith('今日'),
                )
                .map(card => {
                  const previous = comparison.previous?.cards.find(item => item.key === card.key);
                  return (
                    <div key={card.key} className="rounded-lg bg-wash p-3">
                      <p className="text-[12px] text-sub mb-2">{card.label}</p>
                      <div className={styles.compare}>
                        <p className="num text-[12px]">
                          当前 {formatMetricValue(card)}
                          {stateLabels[card.state] ? ` · ${stateLabels[card.state]}` : ''}
                        </p>
                        <p className="num text-[12px]">
                          上周 {previous ? formatMetricValue(previous) : '–'}
                          {previous && stateLabels[previous.state]
                            ? ` · ${stateLabels[previous.state]}`
                            : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              {comparison.fetching ? (
                <p className={styles.help} role="status">
                  正在读取上周范围数据。
                </p>
              ) : comparison.error ? (
                <p className={styles.help} role="alert">
                  读取上周范围数据失败。{' '}
                  <button type="button" className="chip" onClick={comparison.refetch}>
                    重试
                  </button>
                </p>
              ) : !comparison.previous ? (
                <p className={styles.help}>上周范围暂无数据。</p>
              ) : null}
            </div>
          ) : isRange ? (
            <div className={styles.dateFields}>
              <label>
                开始日期
                <input
                  type="date"
                  required
                  value={start}
                  onChange={event => setStart(event.target.value)}
                />
              </label>
              <label>
                结束日期
                <input
                  type="date"
                  required
                  value={end}
                  onChange={event => setEnd(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <>
              {!settingsAction && !isQuery && (
                <label>
                  文件格式
                  <select value={format} onChange={event => setFormat(event.target.value)}>
                    {isCatalog ? (
                      <>
                        <option value="sitemap">Sitemap XML</option>
                        <option value="csv">CSV 页面目录</option>
                        <option value="json">JSON 页面目录</option>
                      </>
                    ) : (
                      <>
                        <option value="combined">Combined 访问日志</option>
                        <option value="json">JSON 记录</option>
                      </>
                    )}
                  </select>
                </label>
              )}
              {!isQuery && (
                <label>
                  选择本地文件
                  <input
                    type="file"
                    accept=".txt,.log,.json,.xml,.csv"
                    disabled={!canManage || busy}
                    onChange={async event => {
                      const file = event.target.files?.[0];
                      if (file) setContent(await file.text());
                    }}
                  />
                </label>
              )}
              <label>
                {isQuery
                  ? '查询关键词'
                  : settingsAction
                    ? '配置内容'
                    : isCatalog
                      ? '页面目录内容'
                      : '访问日志内容'}
                {isQuery ? (
                  <input
                    autoFocus
                    value={content}
                    onChange={event => setContent(event.target.value)}
                    placeholder="User-Agent、页面或状态码"
                  />
                ) : (
                  <textarea
                    value={content}
                    onChange={event => setContent(event.target.value)}
                    disabled={!canManage || busy}
                    spellCheck={false}
                    required={!settingsAction}
                  />
                )}
              </label>
              <p className={styles.help}>
                {settingsAction
                  ? '配置保存在当前站点。robots.txt 可下载后由站点管理员自行部署；白名单与解析规则用于本地分析。'
                  : isCatalog
                    ? '导入站点已发布页面目录，用于页面覆盖率与 AI 盲区判断。'
                    : isQuery
                      ? '筛选当前范围已导入的脱敏访问记录。'
                      : '仅导入当前站点授权的访问日志。JSON 每批上限 1000 条；Combined 上限 10 MiB、10000 行。校验后保存脱敏记录。'}
              </p>
            </>
          )}
          <p role="status" aria-live="polite" className={styles.status}>
            {status || (!canManage && !isQuery && !isRange ? '当前账号仅可查看' : '')}
            {importErrors.map(error => (
              <span key={error.line} className={`block ${styles.help}`}>
                第 {error.line} 行：{error.reason}
              </span>
            ))}
            {totalErrors > importErrors.length && (
              <span className={`block ${styles.help}`}>
                仅显示前 {importErrors.length} 条错误，共拒绝 {totalErrors} 条。
              </span>
            )}
          </p>
          {isQuery && report && (
            <div className={styles.logResults}>
              <label>
                请求类型
                <select
                  aria-label="日志请求类型"
                  value={logsFilter || '全部'}
                  onChange={event => onLogsFilter?.(event.target.value)}
                >
                  <option>全部</option>
                  <option>仅 AI 蜘蛛</option>
                  <option>仅人类</option>
                  <option>仅异常</option>
                </select>
              </label>
              <p className={styles.help}>
                “仅人类”对应未识别或其他请求，服务器日志无法据此确认人类身份。
              </p>
              <div className={styles.logTable}>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-faint border-b border-line">
                      {columns.logBody.map(([, label]) => (
                        <SortHeading key={label} className="px-4 py-3" label={label} />
                      ))}
                    </tr>
                  </thead>
                  <ReportRows table="logBody" report={report} limit={report.meta.pageSize || 100} />
                </table>
              </div>
              <div className={styles.pagination}>
                <span className={styles.help}>
                  {isFetching
                    ? '读取中'
                    : `共 ${report.meta.totalLogs ?? report.tables.logBody?.length ?? 0} 条 · 第 ${report.meta.page || 1} 页`}
                </span>
                <button
                  type="button"
                  className="chip"
                  disabled={(report.meta.page || 1) <= 1 || isFetching}
                  onClick={() => onPage?.((report.meta.page || 1) - 1)}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={
                    (report.meta.page || 1) * (report.meta.pageSize || 100) >=
                      (report.meta.totalLogs || 0) || isFetching
                  }
                  onClick={() => onPage?.((report.meta.page || 1) + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          )}
          <div className={styles.formActions}>
            {action === 'robots.txt 编辑' && (
              <button
                type="button"
                className="chip"
                onClick={() => downloadFile(content, 'robots.txt', 'text/plain;charset=utf-8')}
              >
                下载 robots.txt
              </button>
            )}
            <button type="button" className="chip" onClick={onClose}>
              关闭
            </button>
            {!isComparison && (
              <button
                type="submit"
                className={`chip ${styles.primary}`}
                disabled={busy || (!canManage && !isQuery && !isRange)}
              >
                {busy ? '处理中' : isQuery ? '应用查询' : isRange ? '应用范围' : '保存'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
