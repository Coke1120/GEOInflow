'use client';
import { fromZonedTime } from 'date-fns-tz';
import { useEffect, useId, useRef, useState } from 'react';
import { useApi } from '@/lib/liekan/upstream/client';
import { getFeaturePreferences } from '@/lib/liekan/upstream/features-client';
import {
  managementLabels,
  parseEditableAllowlist,
  parseEditableRules,
} from '@/lib/liekan/contracts/management';
import { BotRulesEditor } from './features/BotRulesEditor';
import { Button, DialogActions, LiekanDialog } from './features/ui';
import { useDialog } from './features/LiekanDialog';
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
  websiteName,
  websiteDomain,
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
  websiteName?: string;
  websiteDomain?: string;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
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
  const timezone = getFeaturePreferences().timezone || 'Asia/Shanghai';
  const formId = useId();
  const saving = useRef(false);
  const [content, setContent] = useState(action === '日志查询' ? initialSearch || '' : '');
  const [importMode, setImportMode] = useState(false);
  const importDraft = useRef('');
  const importDirty = useRef(false);
  const queryDraft = useRef(initialSearch || '');
  const appliedSearch = useRef(initialSearch);
  const [format, setFormat] = useState(action === 'sitemap 管理' ? 'sitemap' : 'combined');
  const [settings, setSettings] = useState<Settings>(null);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [totalErrors, setTotalErrors] = useState(0);
  const [busy, setBusy] = useState(false);
  const initialDate = (value?: number) =>
    value ? new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(value) : '';
  const [start, setStart] = useState(initialDate(report?.range.startAt));
  const [end, setEnd] = useState(initialDate(report?.range.endAt));
  const settingsAction = ['robots.txt 编辑', '蜘蛛白名单', '特征库管理', '解析规则'].includes(
    action,
  );
  const isRules = ['特征库管理', '解析规则'].includes(action);
  const isCatalog = action === 'sitemap 管理';
  const isQuery = action === '日志查询' && !importMode;
  const isRange = action === '统计范围';
  const isComparison = action === '对比上周';
  const title =
    importMode || action === '导入日志' ? '导入访问日志' : managementLabels[action] || action;
  const submitLabel = isQuery
    ? '应用查询'
    : isRange
      ? '应用日期范围'
      : isCatalog
        ? '导入页面目录'
        : isRules
          ? '保存识别规则'
          : action === 'robots.txt 编辑'
            ? '保存 robots.txt'
            : action === '蜘蛛白名单'
              ? '保存白名单'
              : '导入日志';
  const currentWebsite = websiteName || report?.website?.name || '当前网站';
  const currentDomain = websiteDomain || report?.website?.domain;
  const comparisonDate = (value: number) =>
    new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
      hour12: false,
    }).format(value);
  useEffect(() => {
    if (initialSearch === appliedSearch.current) return;
    appliedSearch.current = initialSearch;
    queryDraft.current = initialSearch || '';
    if (isQuery) setContent(queryDraft.current);
  }, [initialSearch, isQuery]);
  useEffect(() => {
    if (!settingsAction) return;
    let alive = true;
    setBusy(true);
    setLoadError('');
    api
      .get('/liekan/websites/' + websiteId + '/settings')
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
        setDirty(false);
      })
      .catch(error => {
        if (alive) setLoadError(error.message || '无法读取设置');
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [action, websiteId, settingsAction, loadVersion]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || saving.current || isComparison) return;
    if (isRange) {
      const startAt = +fromZonedTime(`${start}T00:00:00`, timezone),
        endAt = +fromZonedTime(`${end}T23:59:59.999`, timezone);
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt > endAt) {
        setFailed(true);
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
      setFailed(true);
      setStatus('当前账号没有管理此站点的权限');
      return;
    }
    saving.current = true;
    setBusy(true);
    setFailed(false);
    setStatus('');
    setImportErrors([]);
    setTotalErrors(0);
    try {
      if (settingsAction) {
        if (!settings) throw new Error('请先读取设置');
        let patch: Partial<Settings>;
        if (action === 'robots.txt 编辑') {
          if (content.length > 50000)
            throw new Error('robots.txt 最多 50,000 个字符，请缩减内容后保存。');
          patch = { robots: content };
        } else if (action === '蜘蛛白名单')
          patch = {
            allowlist: parseEditableAllowlist(content),
          };
        else {
          const rules = parseEditableRules(content);
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
        setStatus(
          action === 'robots.txt 编辑'
            ? 'robots.txt 已保存到当前网站设置。下载后部署到网站根目录。'
            : action === '蜘蛛白名单'
              ? '白名单已保存，共 ' + saved.allowlist.length + ' 条。'
              : '蜘蛛识别规则已保存，共 ' + saved.rules.length + ' 条。',
        );
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
      if (action === '日志查询' && importMode) {
        importDraft.current = content;
        importDirty.current = false;
      }
      setDirty(false);
      try {
        await onSaved();
      } catch {
        setStatus(current => `${current} 页面状态刷新失败，请刷新页面确认已保存结果。`);
      }
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <LiekanDialog
      title={title}
      size={isRange || action === '蜘蛛白名单' ? 'standard' : 'wide'}
      subtitle={
        <>
          {currentWebsite}
          {currentDomain ? ' · ' + currentDomain : ''}
          {isRange || isComparison || isQuery ? ' · ' + timezone : ''}
        </>
      }
      protectUnsaved={!busy}
      onClose={() => {
        if (!saving.current) onClose();
      }}
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={submit}
        data-unsaved={dirty ? 'true' : 'false'}
        onChange={() => {
          if (!isQuery && !isRange && !isComparison) setDirty(true);
        }}
      >
        {action === '日志查询' && (
          <div className="tabs" role="tablist" aria-label="访问日志操作">
            <button
              type="button"
              role="tab"
              aria-selected={!importMode}
              className={!importMode ? 'tab on' : 'tab'}
              disabled={busy}
              onClick={() => {
                if (busy || saving.current) return;
                if (importMode) {
                  importDraft.current = content;
                  importDirty.current = dirty;
                }
                setImportMode(false);
                setContent(queryDraft.current);
                setDirty(importDirty.current);
              }}
            >
              查询记录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={importMode}
              className={importMode ? 'tab on' : 'tab'}
              disabled={busy}
              onClick={() => {
                if (busy || saving.current) return;
                if (!importMode) queryDraft.current = content;
                setImportMode(true);
                setContent(importDraft.current);
                setDirty(importDirty.current);
              }}
            >
              导入日志
            </button>
          </div>
        )}
        {loadError && (
          <div className="notice red" role="alert">
            无法读取设置：{loadError}{' '}
            <Button onClick={() => setLoadVersion(v => v + 1)}>重新读取设置</Button>
          </div>
        )}
        {busy && settingsAction && !saving.current && (
          <p role="status" className="muted">
            正在读取网站设置…
          </p>
        )}
        {isComparison ? (
          <>
            <div className="management-grid">
              <div>
                <h3>当前期间</h3>
                <p className={styles.help}>
                  {comparisonDate(comparison.startAt)} 至 {comparisonDate(comparison.endAt)}
                </p>
              </div>
              <div>
                <h3>上周期间</h3>
                <p className={styles.help}>整体前移 7 天</p>
                <p className={styles.help}>
                  {comparisonDate(comparison.previousStartAt)} 至{' '}
                  {comparisonDate(comparison.previousEndAt)}
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="management-comparison">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>当前期间</th>
                    <th>上周期间</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.current?.cards
                    .filter(
                      card =>
                        comparison.labels.includes(card.label) && !card.label.startsWith('今日'),
                    )
                    .map(card => {
                      const previous = comparison.previous?.cards.find(
                        item => item.key === card.key,
                      );
                      return (
                        <tr key={card.key}>
                          <td>{card.label}</td>
                          <td>
                            {formatMetricValue(card)}
                            {stateLabels[card.state] ? ' · ' + stateLabels[card.state] : ''}
                          </td>
                          <td>
                            {previous ? formatMetricValue(previous) : '暂无数据'}
                            {previous && stateLabels[previous.state]
                              ? ' · ' + stateLabels[previous.state]
                              : ''}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {comparison.fetching ? (
              <p role="status">正在读取上周数据…</p>
            ) : comparison.error ? (
              <div className="notice red" role="alert">
                上周数据读取失败。<Button onClick={comparison.refetch}>重新读取</Button>
              </div>
            ) : (
              !comparison.previous && <p className="muted">上周期间暂无数据。</p>
            )}
          </>
        ) : isRange ? (
          <>
            <div className={styles.dateFields}>
              <label>
                开始日期
                <input
                  type="date"
                  required
                  value={start}
                  onChange={e => setStart(e.target.value)}
                />
              </label>
              <label>
                结束日期
                <input type="date" required value={end} onChange={e => setEnd(e.target.value)} />
              </label>
            </div>
            <p className={styles.help}>日期按 {timezone} 时区统计，选择后应用到当前页面。</p>
          </>
        ) : isQuery ? (
          <>
            <div className="management-grid">
              <label>
                查询关键词
                <input
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="User-Agent、页面路径或状态码"
                />
              </label>
              <label>
                请求类型
                <select
                  aria-label="日志请求类型"
                  value={logsFilter || '全部'}
                  onChange={e => onLogsFilter?.(e.target.value)}
                >
                  <option>全部</option>
                  <option>仅 AI 蜘蛛</option>
                  <option>仅人类</option>
                  <option>仅异常</option>
                </select>
              </label>
            </div>
            <p className={styles.help}>
              查询当前统计期间的已导入脱敏记录。“仅人类”显示未识别或其他请求，日志无法据此确认人类身份。
            </p>
            {report && (
              <div className={styles.logResults}>
                <div className={styles.logTable}>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr>
                        {columns.logBody.map(([, label]) => (
                          <SortHeading key={label} className="px-4 py-3" label={label} />
                        ))}
                      </tr>
                    </thead>
                    <ReportRows
                      table="logBody"
                      report={report}
                      limit={report.meta.pageSize || 100}
                    />
                  </table>
                </div>
                <div className={styles.pagination}>
                  <span>
                    {isFetching
                      ? '正在读取记录…'
                      : '共 ' +
                        (report.meta.totalLogs ?? report.tables.logBody?.length ?? 0) +
                        ' 条 · 第 ' +
                        (report.meta.page || 1) +
                        ' 页'}
                  </span>
                  <Button
                    disabled={(report.meta.page || 1) <= 1 || isFetching}
                    onClick={() => onPage?.((report.meta.page || 1) - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    disabled={
                      (report.meta.page || 1) * (report.meta.pageSize || 100) >=
                        (report.meta.totalLogs || 0) || isFetching
                    }
                    onClick={() => onPage?.((report.meta.page || 1) + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {!canManage && (
              <div className="notice amber">当前账户可以查看，修改和导入需要网站管理权限。</div>
            )}
            <div className={'management-input-layout' + (isRules ? ' rules-layout' : '')}>
              <div className="management-input-main">
                {!settingsAction && (
                  <div className="management-grid">
                    <label>
                      文件格式
                      <select
                        value={format}
                        onChange={e => setFormat(e.target.value)}
                        disabled={busy || !canManage}
                      >
                        {isCatalog ? (
                          <>
                            <option value="sitemap">Sitemap XML</option>
                            <option value="csv">CSV 页面目录</option>
                            <option value="json">JSON 页面目录</option>
                          </>
                        ) : (
                          <>
                            <option value="combined">Nginx / Apache Combined</option>
                            <option value="json">JSON 日志记录</option>
                          </>
                        )}
                      </select>
                    </label>
                  </div>
                )}
                <label>
                  选择本地文件
                  <input
                    type="file"
                    accept={
                      isCatalog
                        ? '.xml,.csv,.json'
                        : isRules
                          ? '.json'
                          : settingsAction
                            ? '.txt'
                            : '.txt,.log,.json'
                    }
                    disabled={busy || !canManage}
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        if (!settingsAction && file.size > 10 * 1024 * 1024)
                          throw new Error('文件超过 10 MiB，请拆分后导入。');
                        setContent(await file.text());
                        setDirty(true);
                      } catch (error) {
                        setFailed(true);
                        setStatus(
                          error instanceof Error ? error.message : '无法读取文件，请重新选择。',
                        );
                      }
                    }}
                  />
                </label>
                {isRules ? (
                  <BotRulesEditor
                    content={content}
                    disabled={!canManage || busy || !settings}
                    onChange={value => {
                      setContent(value);
                      setDirty(true);
                    }}
                  />
                ) : (
                  <label>
                    {action === 'robots.txt 编辑'
                      ? 'robots.txt 内容'
                      : action === '蜘蛛白名单'
                        ? 'CIDR 白名单'
                        : isCatalog
                          ? '页面目录内容'
                          : '访问日志内容'}
                    <textarea
                      value={content}
                      onChange={e => setContent(e.target.value)}
                      disabled={!canManage || busy || (settingsAction && !settings)}
                      required={!settingsAction}
                      spellCheck={false}
                      rows={12}
                      placeholder={
                        action === '蜘蛛白名单' ? '每行一个 CIDR，如 192.0.2.0/24' : undefined
                      }
                    />
                  </label>
                )}
              </div>
              <aside className="management-guide">
                <h3>{settingsAction ? '配置说明' : '导入说明'}</h3>
                {action === 'robots.txt 编辑' ? (
                  <>
                    <p>此配置保存到当前网站设置。</p>
                    <p>下载 robots.txt 后，由网站管理员部署到目标网站根目录。</p>
                    <p>最多 50,000 个字符。</p>
                  </>
                ) : action === '蜘蛛白名单' ? (
                  <>
                    <p>每行填写一个合法的 IPv4 或 IPv6 CIDR，最多 100 条。</p>
                    <p>此名单保存在当前网站设置中，当前日志导入和请求拦截尚未使用该配置。</p>
                  </>
                ) : isRules ? (
                  <>
                    <p>设置蜘蛛名称、厂商、类型与 User-Agent 匹配词。</p>
                    <p>按条目顺序进行文本包含匹配，忽略大小写。</p>
                    <p>规则用于后续日志识别。高级 JSON 编辑保留原有字段。</p>
                  </>
                ) : isCatalog ? (
                  <>
                    <p>导入已发布页面目录，用于页面覆盖率与 AI 盲区分析。</p>
                    <p>Sitemap XML 支持 urlset 页面列表，暂不支持 sitemap 索引。</p>
                    <p>CSV / JSON 使用 url 或 path 字段，可附带已有内容元数据。</p>
                    <p>文件最多 10 MiB、10,000 个页面；导入会新增或更新对应页面。</p>
                  </>
                ) : (
                  <>
                    <p>确认日志属于当前网站，并选择对应格式。</p>
                    <p>JSON 每批最多 1000 条；Combined 最多 10 MiB、10,000 行。</p>
                    <p>原生 CDN 日志需先转换为支持的字段格式。</p>
                    <p>校验后保存脱敏记录，结果分别显示新增、重复和拒绝数量。</p>
                  </>
                )}
              </aside>
            </div>
          </>
        )}
        {status && (
          <section
            className={'notice ' + (failed ? 'red' : totalErrors ? 'amber' : 'blue')}
            role={failed ? 'alert' : 'status'}
            aria-live="polite"
          >
            <strong>{failed ? '操作未完成' : totalErrors ? '部分记录未导入' : '操作结果'}</strong>
            <p>{status}</p>
            {importErrors.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>拒绝原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importErrors.map(error => (
                      <tr key={error.line}>
                        <td>{error.line}</td>
                        <td>{error.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalErrors > importErrors.length && (
              <p>
                显示前 {importErrors.length} 条错误，共拒绝 {totalErrors} 条。
              </p>
            )}
          </section>
        )}
        <DialogActions>
          {action === 'robots.txt 编辑' && (
            <button
              type="button"
              className="btn dialog-secondary-action"
              disabled={busy || !settings}
              onClick={() => downloadFile(content, 'robots.txt', 'text/plain;charset=utf-8')}
            >
              下载 robots.txt
            </button>
          )}
          <ManagementClose label={isComparison ? '关闭' : '取消'} disabled={saving.current} />
          {!isComparison && (
            <button
              type="submit"
              form={formId}
              className="btn primary"
              disabled={
                busy || (settingsAction && !settings) || (!canManage && !isQuery && !isRange)
              }
            >
              {busy ? '正在' + submitLabel + '…' : submitLabel}
            </button>
          )}
        </DialogActions>
      </form>
    </LiekanDialog>
  );
}
function ManagementClose({ label, disabled }: { label: string; disabled: boolean }) {
  const dialog = useDialog();
  return (
    <Button disabled={disabled} onClick={dialog?.requestClose}>
      {label}
    </Button>
  );
}
