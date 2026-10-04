'use client';
import { useListState } from './listState';
import Link from 'next/link';
import {
  createContext,
  Fragment,
  type InputHTMLAttributes,
  isValidElement,
  type ReactNode,
  type SelectHTMLAttributes,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useFeature } from './context';
import { DataLoadingContext, hidesPreviousData, useDataLoading } from '../LoadingState';
import { QueryFeedback } from '../QueryFeedback';
import loadingStyles from '@/styles/liekan/Shell.module.css';
import { featureIcons } from './icons';

export function Icon({ name = 'down' }: { name?: string }) {
  const paths = {
    down: 'm6 9 6 6 6-6',
    plus: 'M12 5v14M5 12h14',
    close: 'm6 6 12 12M6 18 18 6',
    back: 'm12 5-7 7 7 7M5 12h15',
    copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
    menu: 'M3 6h18M3 12h18M3 18h18',
    bars: 'M4 20V10M10 20V4M16 20v-8M22 20V7',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    globe: 'M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  };
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: featureIcons[name] || `<path d="${paths[name] || paths.grid}"/>`,
      }}
    />
  );
}
export function Button({ children, primary = false, danger = false, onClick, ...props }: any) {
  const [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className={`btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}`}
        {...props}
        onClick={async e => {
          try {
            setError('');
            await onClick?.(e);
          } catch (e: any) {
            setError(e?.message || '操作失败');
          }
        }}
      >
        {children}
      </button>
      {error && (
        <span role="alert" className="field-error">
          {error}
        </span>
      )}
    </>
  );
}
export function LinkButton({ children, page, params, primary = false, ...props }: any) {
  const c = useFeature();
  return (
    <Link
      prefetch={false}
      className={`btn${primary ? ' primary' : ''}`}
      href={c.href(page, params)}
      {...props}
    >
      {children}
    </Link>
  );
}
const SearchContext = createContext<any>(null);
export function Panel({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [search, setSearch] = useListState('search', '');
  const [searchable, setSearchable] = useState(false);
  return (
    <SearchContext.Provider value={{ search, setSearch, register: setSearchable }}>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {(actions || searchable) && (
            <div className="actions">
              {searchable && (
                <label className="search">
                  <input
                    type="search"
                    aria-label="搜索本页记录"
                    placeholder="搜索本页记录"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </label>
              )}
              {actions}
            </div>
          )}
        </div>
        {children}
      </section>
    </SearchContext.Provider>
  );
}
export const Body = ({ children }: { children: ReactNode }) => (
  <div className="panel-body">{children}</div>
);
export const Notice = ({ children, tone = '' }: { children: ReactNode; tone?: string }) => (
  <div className={`notice ${tone}`} role={tone === 'red' ? 'alert' : 'status'}>
    {children}
  </div>
);
export const Badge = ({ children, tone = 'gray' }: { children: ReactNode; tone?: string }) => (
  <span className={`badge ${tone}`}>{children}</span>
);
export function Metrics({
  items,
  className = '',
  loading = false,
}: {
  items: [string, ReactNode, ReactNode?, string?][];
  className?: string;
  loading?: boolean;
}) {
  const pending = useDataLoading() || loading;
  return (
    <div className={`metrics ${className}`} aria-busy={pending || undefined}>
      {items.map(([label, value, description, color], i) => (
        <div className="metric" key={i}>
          <p className="metric-label">{label}</p>
          <p className={`metric-value num ${color || 'blue'}`}>{pending ? '—' : (value ?? '—')}</p>
          {description && <p className="metric-foot">{pending ? '正在读取' : description}</p>}
        </div>
      ))}
    </div>
  );
}
export function Definition({ items }: { items: [string, ReactNode][] }) {
  const loading = useDataLoading();
  return (
    <dl className="definition">
      {items.map(([key, value], i) => (
        <Fragment key={i}>
          <dt>{key}</dt>
          <dd>{loading ? '正在读取' : (value ?? '—')}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
export function Field({
  label,
  help,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: ReactNode; error?: string }) {
  return (
    <label className="field">
      <span>
        {label}
        {props.required && <span className="required"> *</span>}
      </span>
      <input {...props} />
      {help && <small className="field-help">{help}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}
export function Select({
  label,
  options,
  help,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: (string | [string, string] | { value: string; label: string; disabled?: boolean })[];
  help?: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="select-wrap">
        <select {...props}>
          {options.map((o, i) => {
            const [v, l] =
              typeof o === 'string' ? [o, o] : Array.isArray(o) ? o : [o.value, o.label];
            return (
              <option
                key={i}
                value={v}
                disabled={typeof o === 'object' && !Array.isArray(o) && o.disabled}
              >
                {l}
              </option>
            );
          })}
        </select>
        <Icon />
      </span>
      {help && <small className="field-help">{help}</small>}
    </label>
  );
}
export const Textarea = ({ label, help, ...props }: any) => (
  <label className="field">
    <span>{label}</span>
    <textarea {...props} />
    {help && <small className="field-help">{help}</small>}
  </label>
);
export const Check = ({ children, label, ...props }: any) => (
  <label className="check">
    <input type="checkbox" {...props} />
    <span>{children || label}</span>
  </label>
);
export const Switch = ({ label, help, ...props }: any) => (
  <label className="switch-row">
    <span>
      <strong>{label}</strong>
      {help && <small style={{ display: 'block', marginTop: 4 }}>{help}</small>}
    </span>
    <input type="checkbox" className="switch" aria-label={label} {...props} />
  </label>
);
export function Form({
  children,
  onSubmit,
  submitLabel = '保存',
  busy = false,
  disabled = false,
  error,
  cancel,
  trackUnsaved = true,
}: any) {
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (trackUnsaved && form.current?.dataset.unsaved === 'true') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [trackUnsaved]);
  return (
    <form
      ref={form}
      className="form form-stack"
      onClickCapture={event => {
        if (
          trackUnsaved &&
          (event.target as Element).closest(
            'button[data-dirty-action="true"], [data-dirty-actions] button[type="button"]',
          )
        )
          event.currentTarget.dataset.unsaved = 'true';
      }}
      onChange={event => {
        if (trackUnsaved) event.currentTarget.dataset.unsaved = 'true';
      }}
      onSubmit={async e => {
        e.preventDefault();
        if (busy || submitting || disabled) return;
        const el = e.currentTarget;
        setLocalError('');
        setSubmitting(true);
        try {
          await onSubmit(Object.fromEntries(new FormData(el)), el);
          el.dataset.unsaved = 'false';
        } catch (e: any) {
          setLocalError(e?.message || '操作失败');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <fieldset
        disabled={busy || submitting || disabled}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {children}
      </fieldset>
      {(error || localError) && <Notice tone="red">{error || localError}</Notice>}
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={busy || submitting || disabled}>
          {busy || submitting ? `正在${submitLabel}…` : submitLabel}
        </button>
        {cancel}
      </div>
    </form>
  );
}
export function Tabs({
  items,
  active,
  onChange,
}: {
  items: [string, string][];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([id, label]) => (
        <button
          type="button"
          className={`tab${id === active ? ' on' : ''}`}
          role="tab"
          aria-selected={id === active}
          key={id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export const Code = ({ children }: { children: ReactNode }) => (
  <pre className="code-block">
    <code>{children}</code>
  </pre>
);
export function Table({
  columns,
  rows,
  numeric = [],
  empty = '当前范围没有数据',
  page,
  pages,
  onPage,
  search = false,
}: {
  columns: string[];
  rows: ReactNode[][];
  numeric?: number[];
  empty?: string;
  page?: number;
  pages?: number;
  onPage?: (page: number) => void;
  search?: boolean;
}) {
  const c = useFeature();
  const panel = useContext(SearchContext);
  const loading = useDataLoading();
  useEffect(() => {
    if (!loading && pages >= 1 && page > pages) onPage?.(pages);
  }, [loading, page, pages, onPage]);
  const [text, setText] = useState('');
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(() => {
    const index = columns.indexOf(c?.query?.sort);
    return index >= 0 ? { column: index, desc: c?.query?.direction === 'desc' } : null;
  });
  useEffect(() => {
    if (!panel || !search) return;
    panel.register(true);
    return () => panel.register(false);
  }, [panel?.register, search]);
  const flatten = (node: any): string =>
    node == null
      ? ''
      : typeof node === 'string' || typeof node === 'number'
        ? String(node)
        : Array.isArray(node)
          ? node.map(flatten).join('')
          : isValidElement(node)
            ? flatten((node.props as any).children)
            : '';
  useEffect(() => {
    if (!c?.query) return;
    const index = columns.indexOf(c.query.sort);
    setSort(index >= 0 ? { column: index, desc: c.query.direction === 'desc' } : null);
  }, [c?.query?.sort, c?.query?.direction, columns.join('|')]);
  const term = panel?.search ?? text;
  let filtered =
    search && term
      ? rows.filter(row => row.some(v => flatten(v).toLowerCase().includes(term.toLowerCase())))
      : rows;
  if (sort)
    filtered = [...filtered].sort((a, b) => {
      const x = flatten(a[sort.column]),
        y = flatten(b[sort.column]);
      const d = numeric.includes(sort.column)
        ? Number(x.replace(/[^\d.-]/g, '')) - Number(y.replace(/[^\d.-]/g, ''))
        : x.localeCompare(y, 'zh-CN', { numeric: true });
      return sort.desc ? -d : d;
    });
  return (
    <>
      {search && !panel && (
        <label className="search">
          <input
            aria-label="搜索本页记录"
            placeholder="搜索本页记录"
            value={text}
            onChange={e => setText(e.target.value)}
          />
        </label>
      )}
      <div className="table-wrap">
        <table
          style={
            {
              '--table-min': `${columns.length <= 4 ? 40 + columns.length * 100 : columns.length * 110}px`,
            } as any
          }
        >
          <thead>
            <tr>
              {columns.map((x, i) => (
                <th
                  key={i}
                  scope="col"
                  className={numeric.includes(i) ? 'numeric' : ''}
                  aria-sort={sort?.column === i ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                >
                  <button
                    className="table-sort"
                    onClick={() => {
                      const desc = sort?.column === i ? !sort.desc : false;
                      setSort({ column: i, desc });
                      c?.updateQuery?.({ sort: x, direction: desc ? 'desc' : 'asc' });
                    }}
                  >
                    {x}{' '}
                    <span aria-hidden="true">
                      {sort?.column === i ? (sort.desc ? '↓' : '↑') : '↕'}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i} aria-hidden="true">
                  {columns.map((column, j) => (
                    <td key={j}>
                      <span className={loadingStyles.loadingCell} />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length ? (
              filtered.map((row, i) => (
                <tr key={i}>
                  {row.map((v, j) => (
                    <td key={j} className={numeric.includes(j) ? 'numeric' : ''}>
                      {v ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  <div className="state-box">{empty}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>{loading ? '正在读取记录' : `${filtered.length} 条记录 · 表头可排序`}</span>
        {pages > 1 ? (
          <div className="actions">
            <span>
              {page} / {pages}
            </span>
            <Button disabled={page <= 1} onClick={() => onPage?.(page - 1)}>
              上一页
            </Button>
            <Button disabled={page >= pages} onClick={() => onPage?.(page + 1)}>
              下一页
            </Button>
          </div>
        ) : (
          <span>本页展示当前记录</span>
        )}
      </div>
    </>
  );
}
export function QueryState({
  query,
  children,
  readOnly = false,
  loadingFallback,
}: {
  query: any;
  children: ReactNode;
  readOnly?: boolean;
  loadingFallback?: ReactNode;
}) {
  if (
    readOnly &&
    !hidesPreviousData(query.error) &&
    (query.isPending || query.data !== undefined || !query.error)
  ) {
    return (
      <div
        className={loadingStyles.readRegion}
        data-liekan-read-region
        aria-busy={query.isPending || query.isFetching || undefined}
      >
        <DataLoadingContext.Provider value={!!query.isPending}>
          {query.isPending && loadingFallback ? loadingFallback : children}
        </DataLoadingContext.Provider>
        {query.isPending ? (
          <span className={loadingStyles.srOnly} role="status">
            正在读取当前范围的数据
          </span>
        ) : (
          <QueryFeedback query={query} />
        )}
      </div>
    );
  }
  if (query.isPending)
    return (
      <div className="state-box" role="status">
        <h3>正在加载</h3>
        <p>正在读取当前范围的数据。</p>
      </div>
    );
  if (query.error)
    return (
      <div className="state-box" role="alert">
        <h3>
          {query.error.status === 401
            ? '需要重新登录'
            : query.error.status === 403
              ? '没有访问权限'
              : query.error.status === 404
                ? '资源不存在或已删除'
                : '读取失败'}
        </h3>
        <p>{query.error.message}</p>
        {query.error.status === 401 ? (
          <a className="btn primary" href={`${process.env.basePath || ''}/login`}>
            重新登录
          </a>
        ) : (
          <Button onClick={() => query.refetch?.()}>重试读取</Button>
        )}
      </div>
    );
  return <>{children}</>;
}
export function Drawer({
  title,
  subtitle,
  children,
  onClose,
  variant = 'drawer',
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  variant?: 'drawer' | 'modal';
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const descriptionId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const focusable = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]',
          ) || [],
        );
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener('keydown', handle);
      trigger?.focus();
    };
  }, []);
  return createPortal(
    <div
      data-liekan-features
      className={`dialog-overlay${variant === 'modal' ? ' modal-overlay' : ''}`}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`${variant} ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={subtitle ? descriptionId : undefined}
      >
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && (
              <p id={descriptionId} className="muted">
                {subtitle}
              </p>
            )}
          </div>
          <Button aria-label="关闭弹层" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
        <div className="drawer-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
