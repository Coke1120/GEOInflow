import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricCard, ReportList, ReportRows } from './ReportComponents';
import type { LiekanReport } from './types';
import { pageSearch, pageUrl } from '@/lib/liekan/contracts/page-url';
import { pageLink, pageSequence } from './PageLink';
import { Panel, Table } from './features/ui';
import { fireEvent } from '@testing-library/react';
import { ReportContext } from './ReportContext';
import { selectRows, tableCsv } from './data';

function report(): LiekanReport {
  return {
    contractVersion: 2,
    website: { id: 'site', name: '当前网站', domain: 'www.example.test' },
    range: { startAt: 1, endAt: 2, timezone: 'Asia/Shanghai' },
    states: { human: 'available', logs: 'available', catalog: 'available', goals: 'empty' },
    cards: [{ key: 'entry', label: '入口页 TOP1', value: '/', state: 'available' }],
    charts: {},
    tables: {},
    insights: [],
    meta: { demo: false, canManage: false, latestImportAt: null, ruleCount: 0 },
  };
}

describe('page addresses in analytics reports', () => {
  it.each([
    ['/', 'www.example.test', undefined, 'https://www.example.test/'],
    ['/about/', 'http://localhost:8080/', undefined, 'http://localhost:8080/about/'],
    ['/#resources', 'example.test', undefined, 'https://example.test/#resources'],
    ['/a%2Fb?x=1#title', 'example.test', 'x=2', 'https://example.test/a%2Fb?x=1#title'],
    [
      '/search#results',
      'example.test',
      '?q=one&x=%2F',
      'https://example.test/search?q=one&x=%2F#results',
    ],
    ['https://other.test/path?q=1', undefined, undefined, 'https://other.test/path?q=1'],
    ['/about', 'https://example.test/subdirectory', undefined, null],
    ['/about', 'example.test,other.test', undefined, null],
    ['/about', '*.example.test', undefined, null],
    ['/about', undefined, undefined, null],
    ['//other.test/path', 'example.test', undefined, null],
    ['/\\other.test/path', 'example.test', undefined, null],
    ['javascript:alert(1)', 'example.test', undefined, null],
    ['https://user:password@example.test/', undefined, undefined, null],
    ['purchase', 'example.test', undefined, null],
    [null, 'example.test', undefined, null],
  ])(
    'resolves %s with origin %s without inventing an address',
    (value, domain, query, expected) => {
      expect(pageUrl(value, domain, { query })).toBe(expected);
    },
  );

  it('retains the configured protocol and port for the observed hostname', () => {
    expect(pageUrl('/about', 'http://localhost:8080', { hostname: 'localhost' })).toBe(
      'http://localhost:8080/about',
    );
    expect(
      pageUrl('/about', 'https://www.example.test:8443', { hostname: 'www.example.test' }),
    ).toBe('https://www.example.test:8443/about');
    expect(pageUrl('/about', 'www.example.test', { hostname: 'docs.example.test' })).toBe(
      'https://docs.example.test/about',
    );
    expect(
      pageUrl('/about', 'https://www.example.test:8443', { hostname: 'docs.example.test' }),
    ).toBe('https://docs.example.test/about');
    expect(pageUrl('/about', undefined, { hostname: 'docs.example.test' })).toBe(
      'https://docs.example.test/about',
    );
  });

  it('filters displayed report URLs and exports the same selection with original paths', () => {
    const data = report();
    data.tables.pgBody = [
      { path: '/about', pv: 7 },
      { path: '/contact', pv: 2 },
    ];
    const sort = { label: '', direction: -1 };
    const query = 'https://www.example.test/about';
    const actions = {
      filter: '',
      query,
      sort,
      period: '30 天',
      onFilter() {},
      onSort() {},
      onAction() {},
    };
    render(
      <ReportContext.Provider value={actions}>
        <table>
          <ReportRows table="pgBody" report={data} />
        </table>
      </ReportContext.Provider>,
    );
    expect(screen.getByRole('link')).toHaveTextContent(query);
    const displayPath = (value: unknown) => pageUrl(value, data.website.domain);
    expect(selectRows(data.tables.pgBody, '', sort, 'pgBody', query, displayPath)).toEqual([
      { path: '/about', pv: 7 },
    ]);
    const csv = tableCsv('pgBody', data.tables.pgBody, '', sort, query, displayPath);
    expect(csv).toContain('"/about"');
    expect(csv).not.toContain('/contact');
  });

  it('translates a current-site URL into a stored log path while preserving other search text', () => {
    expect(pageSearch('https://www.example.test/about?x=1#team', 'www.example.test')).toBe(
      '/about?x=1#team',
    );
    expect(pageSearch('http://localhost:8080/', 'http://localhost:8080')).toBe('/');
    expect(pageSearch('https://other.test/about', 'www.example.test')).toBe(
      'https://other.test/about',
    );
    expect(pageSearch('Googlebot', 'www.example.test')).toBe('Googlebot');
    expect(pageSearch('/about', 'www.example.test')).toBe('/about');
  });

  it.each([
    ['www.example.test/about', 'www.example.test', '/about'],
    ['example.test/about', 'www.example.test', '/about'],
    ['EXAMPLE.TEST/about', 'www.example.test', '/about'],
    ['/www.example.test/about', 'www.example.test', '/about'],
    ['ttps://www.example.test/about', 'www.example.test', '/about'],
    ['localhost:8080/about', 'http://localhost:8080', '/about'],
    ['www.example.test', 'www.example.test', ''],
    ['/www.example.test', 'www.example.test', ''],
    ['example.test', 'www.example.test', ''],
    ['https://', 'www.example.test', ''],
  ])('keeps displayed log address search %s aligned with the server', (search, domain, expected) => {
    const rows = [{ path: '/about', method: 'GET' }, { path: '/contact', method: 'GET' }];
    const sort = { label: '', direction: -1 };
    const displayPath = (value: unknown) => pageUrl(value, domain);
    const local = selectRows(rows, '', sort, 'logBody', search, displayPath);
    expect(local.length).toBeGreaterThan(0);
    const serverSearch = pageSearch(search, domain);
    expect(serverSearch).toBe(expected);
    const serverRows = rows.filter(row =>
      `${row.path} ${row.method}`.toLowerCase().includes(serverSearch.toLowerCase()),
    );
    expect(selectRows(serverRows, '', sort, 'logBody', search, displayPath)).toEqual(local);
  });

  it.each([
    ['example.test.attacker.test/about', 'www.example.test'],
    ['www.example.test@attacker.test/about', 'www.example.test'],
    ['https://other.test/about', 'www.example.test'],
    ['http://www.example.test/about', 'www.example.test'],
    ['www.example.test:8443/about', 'www.example.test'],
    ['www.example.test/about', '*.example.test'],
    ['www.example.test/about', 'example.test,other.test'],
    ['Googlebot', 'www.example.test'],
    ['/about', 'www.example.test'],
    ['/', 'www.example.test'],
  ])('preserves unrelated or unresolved log search %s', (search, domain) => {
    expect(pageSearch(search, domain)).toBe(search);
  });

  it('keeps completed addresses searchable in feature tables', () => {
    render(
      <Panel title="页面">
        <Table
          search
          columns={['页面', '访客']}
          rows={[
            [pageLink('/about', 'example.test'), 2],
            [pageSequence(['/', '/contact'], 'second.test'), 1],
          ]}
        />
      </Panel>,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'second.test/contact' } });
    expect(screen.queryByText('https://example.test/about')).not.toBeInTheDocument();
    expect(screen.getByText('https://second.test/contact')).toBeInTheDocument();
  });

  it('keeps decoded page paths searchable after displaying encoded addresses', () => {
    render(
      <Panel title="页面">
        <Table
          search
          columns={['页面', '访客']}
          rows={[
            [pageLink('/中文 页面', 'example.test'), 2],
            [pageSequence(['/', '/第二页'], 'example.test'), 1],
            [pageLink('/other', 'example.test'), 1],
          ]}
        />
      </Panel>,
    );
    const input = screen.getByRole('searchbox');
    for (const value of ['中文', '/中文 页面', '%E4%B8%AD%E6%96%87%20']) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getAllByRole('link')).toHaveLength(1);
      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        'https://example.test/%E4%B8%AD%E6%96%87%20%E9%A1%B5%E9%9D%A2',
      );
    }
    fireEvent.change(input, { target: { value: '第二页' } });
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      'https://example.test/',
      'https://example.test/%E7%AC%AC%E4%BA%8C%E9%A1%B5',
    ]);
  });

  it('sorts feature page links by the displayed address', () => {
    render(
      <Panel title="页面">
        <Table
          search
          columns={['页面', '访客']}
          rows={[
            [pageLink('https://b.test/a'), 1],
            [pageLink('/z', 'a.test'), 1],
          ]}
        />
      </Panel>,
    );
    fireEvent.click(screen.getByRole('button', { name: '页面' }));
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      'https://a.test/z',
      'https://b.test/a',
    ]);
  });

  it.each([
    '/ → /第二页',
    'https://example.test/ → https://example.test/%E7%AC%AC%E4%BA%8C%E9%A1%B5',
  ])('keeps a complete page sequence searchable as %s', search => {
    render(
      <Panel title="访问旅程">
        <Table
          search
          columns={['路径', '访客']}
          rows={[
            [pageSequence(['/', '/第二页'], 'example.test'), 2],
            [pageSequence(['/', '/other'], 'example.test'), 1],
          ]}
        />
      </Panel>,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: search } });
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      'https://example.test/',
      'https://example.test/%E7%AC%AC%E4%BA%8C%E9%A1%B5',
    ]);
  });
  it.each(['pgBody', 'visitorPgBody', 'visitorTopBody', 'topBody', 'apBody', 'logBody'])(
    'completes and opens the page address in %s',
    table => {
      const data = report();
      data.tables[table] = [{ path: '/about?from=search#team', method: 'GET' }];
      render(
        <table>
          <ReportRows table={table} report={data} />
        </table>,
      );
      const link = screen.getByRole('link');
      expect(link).toHaveTextContent('https://www.example.test/about?from=search#team');
      expect(link).toHaveAttribute('href', 'https://www.example.test/about?from=search#team');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      if (table === 'logBody') expect(link.parentElement).toHaveTextContent('GET');
    },
  );

  it('makes each journey step openable and preserves its order and count', () => {
    const data = report();
    data.tables.journeyList = [{ path: '/ → /about → /#resources', count: 12 }];
    const { container } = render(<ReportList id="journeyList" className="" report={data} />);
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      'https://www.example.test/',
      'https://www.example.test/about',
      'https://www.example.test/#resources',
    ]);
    expect(container).toHaveTextContent('3 页');
    expect(container).toHaveTextContent('12 会话');
    expect(container).toHaveTextContent('100%');
  });

  it('completes the entry metric and uses the current report domain after a site change', () => {
    const data = report();
    const { rerender } = render(
      <MetricCard label="入口页 TOP1" className="" valueClass="" report={data} />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://www.example.test/');
    rerender(
      <MetricCard
        label="入口页 TOP1"
        className=""
        valueClass=""
        report={{ ...data, website: { ...data.website, domain: 'second.test' } }}
      />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://second.test/');
  });

  it('preserves missing and unsafe addresses as plain text', () => {
    const data = report();
    data.website.domain = '*.example.test';
    data.tables.pgBody = [{ path: '/about' }, { path: 'javascript:alert(1)' }, { path: null }];
    const { container } = render(
      <table>
        <ReportRows table="pgBody" report={data} />
      </table>,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(within(container).getByText('/about')).toBeInTheDocument();
    expect(within(container).getByText('javascript:alert(1)')).toBeInTheDocument();
  });
});
