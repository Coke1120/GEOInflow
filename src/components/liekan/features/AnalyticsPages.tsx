'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  conditionsToQuery,
  duration,
  percentage,
  retentionSummary,
  completedObservationDate,
  relativeDaySeries,
  savedConditionParameters,
  decodePropertyConditions,
  type AnalysisCondition,
  type JourneyData,
} from '@/lib/liekan/contracts/analysis';
import { classifyEntrySource } from '@/lib/liekan/contracts/sources';
import { numberLabel, rowsOf } from '@/lib/liekan/contracts/features';
import { getAllFeatureRows } from '@/lib/liekan/upstream/features-client';
import { useFeature, useData, useAction } from './context';
import { Chart } from './Chart';
import {
  Badge,
  Body,
  Button,
  Definition,
  Drawer,
  Field,
  Form,
  Icon,
  LinkButton,
  Metrics,
  Notice,
  Panel,
  QueryState,
  Select,
  Table,
  Tabs,
  Textarea,
} from './ui';

export const analysisPages = new Set([
  'realtime',
  'events',
  'event-detail',
  'sessions',
  'session-detail',
  'filters',
  'segments',
  'segment-editor',
  'cohorts',
  'cohort-editor',
  'retention',
  'journeys',
  'path-detail',
  'utm',
  'attribution',
  'breakdown',
  'compare',
  'annotations',
]);
const n = numberLabel;
function useScope(extra: any = {}) {
  const c = useFeature();
  return { ...c.range, ...c.filters, ...extra };
}
function useWebsiteData(
  key: any[],
  suffix: string,
  params: any = {},
  enabled = true,
  owned = false,
) {
  const c = useFeature();
  return useData(
    key,
    signal => c.api.get(`${owned ? '/liekan' : ''}/websites/${c.siteId}/${suffix}`, params, signal),
    !!c.siteId && enabled,
  );
}
const visitor = (id: string) => `访客 ${id?.replaceAll('-', '').slice(-6) || '—'}`;
function date(value: any, timezone: string) {
  return value ? formatInTimeZone(value, timezone, 'yyyy-MM-dd HH:mm:ss') : '—';
}
export function canManage(c: ReturnType<typeof useFeature>) {
  return (
    c.user.isAdmin ||
    c.site?.userId === c.user.id ||
    c.teams.some(
      t =>
        t.id === c.site?.teamId &&
        t.members?.some(
          (m: any) =>
            m.userId === c.user.id &&
            ['team-owner', 'team-manager', 'team-member'].includes(m.role),
        ),
    )
  );
}
function ActionLink({
  page,
  params = {},
  children,
}: {
  page: string;
  params?: any;
  children: any;
}) {
  const c = useFeature();
  return (
    <Link
      prefetch={false}
      href={c.href(page, {
        ...c.filters,
        date: `range:${c.range.startAt}:${c.range.endAt}:${c.range.unit}`,
        ...params,
      })}
    >
      {children} →
    </Link>
  );
}

export function SessionTable({
  title = '访问记录',
  params = {},
  live = false,
  refreshToken = 0,
}: {
  title?: string;
  params?: any;
  live?: boolean;
  refreshToken?: number;
}) {
  const c = useFeature();
  const [page, setPage] = useState(1);
  const scope = useScope({ ...params, kind: 'sessions', page });
  useEffect(
    () => setPage(1),
    [c.siteId, JSON.stringify(c.filters), c.range.startAt, c.range.endAt, JSON.stringify(params)],
  );
  const query = useData(
    ['sessions-rich', live ? { ...c.filters, timezone: c.range.timezone, page, live } : scope],
    signal => {
      const endAt = Date.now();
      return c.api.get(
        `/liekan/websites/${c.siteId}/analytics`,
        live
          ? {
              ...scope,
              startAt: endAt - 30 * 60000,
              endAt,
            }
          : scope,
        signal,
      );
    },
    !!c.siteId,
    live ? { refetchOnMount: 'always', staleTime: 0 } : {},
  );
  useEffect(() => {
    if (!live || refreshToken === 0) return;
    if (page !== 1) setPage(1);
    else void query.refetch?.({ cancelRefetch: false });
  }, [refreshToken]);
  const data = query.data;
  return (
    <Panel
      title={title}
      subtitle="按当前日期与条件读取访问记录。会话是一次连续访问，访客标识脱敏显示。"
      actions={<LinkButton page="filters">筛选</LinkButton>}
    >
      <QueryState readOnly query={query}>
        <Table
          search
          columns={['访客', '访问时间', '地域', '来源', '当前页面', '页面数', '时长', '操作']}
          numeric={[5, 6]}
          page={page}
          pages={Math.ceil((data?.count || 0) / 25)}
          onPage={setPage}
          rows={(data?.rows || []).map((r: any) => [
            visitor(r.id),
            date(r.lastAt, c.range.timezone),
            [r.city, r.country].filter(Boolean).join('，') || '未提供',
            classifyEntrySource({ referrer: r.referrerDomain }).source,
            r.urlPath || '未提供',
            n(r.views),
            duration(r.seconds),
            <ActionLink page="session-detail" params={{ id: r.id }} key={r.id}>
              详情
            </ActionLink>,
          ])}
        />
      </QueryState>
    </Panel>
  );
}
function Realtime() {
  const c = useFeature();
  const [refreshToken, setRefreshToken] = useState(0);
  const query = useData(
    ['realtime-rich', c.range.timezone],
    signal => {
      const endAt = Date.now();
      return c.api.get(
        `/liekan/websites/${c.siteId}/analytics`,
        {
          startAt: endAt - 30 * 60000,
          endAt,
          timezone: c.range.timezone,
          unit: 'minute',
          ...c.filters,
          kind: 'realtime',
        },
        signal,
      );
    },
    !!c.siteId,
    { refetchOnMount: 'always', staleTime: 0 },
  );
  const timeline = useData(
    ['realtime-series', c.range.timezone],
    signal =>
      c.api.get(
        `/realtime/${c.siteId}`,
        { timezone: c.range.timezone, unit: 'minute', ...c.filters },
        signal,
      ),
    !!c.siteId,
    { refetchOnMount: 'always', staleTime: 0 },
  );
  const refresh = () => {
    setRefreshToken(value => value + 1);
    return Promise.all([
      query.refetch?.({ cancelRefetch: false }),
      timeline.refetch?.({ cancelRefetch: false }),
    ]);
  };
  useEffect(() => {
    const timer = setInterval(() => {
      void query.refetch?.({ cancelRefetch: false });
      void timeline.refetch?.({ cancelRefetch: false });
      setRefreshToken(value => value + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [query.refetch, timeline.refetch]);
  const totals = query.data?.totals;
  const series = timeline.data?.series?.visitors || [];
  return (
    <>
      <Metrics
        loading={!!query.isPending}
        items={[
          ['当前活跃', totals ? n(totals.active) : null, '过去 5 分钟', 'blue'],
          ['页面访问', totals ? n(totals.views) : null, '过去 30 分钟'],
          ['访问事件', totals ? n(totals.events) : null, '过去 30 分钟'],
          ['AI 引荐访客', totals ? n(totals.ai) : null, '由访问来源识别'],
        ]}
      />
      <Panel
        title="过去 30 分钟的访客"
        subtitle="每 30 秒更新，访客序列以分钟聚合。"
        actions={<Button onClick={refresh}>刷新</Button>}
      >
        <QueryState readOnly query={timeline}>
          <Chart
            type="bar"
            labels={series.map((r: any) => r.x)}
            series={[{ name: '访客', values: series.map((r: any) => Number(r.y)) }]}
          />
        </QueryState>
      </Panel>
      <div className="two">
        <Panel title="热门页面" subtitle="当前活跃访客访问的页面。">
          <QueryState readOnly query={query}>
            <Table
              columns={['页面', '活跃访客']}
              rows={(query.data?.pages || []).map((r: any) => [r.name, n(r.value)])}
              numeric={[1]}
            />
          </QueryState>
        </Panel>
        <Panel title="访问来源" subtitle="来源识别基于可用的引荐信息。">
          <QueryState readOnly query={query}>
            <Table
              columns={['来源', '活跃访客']}
              rows={(query.data?.sources || []).map((r: any) => [r.name, n(r.value)])}
              numeric={[1]}
            />
          </QueryState>
        </Panel>
      </div>
      <SessionTable title="最新访问" live refreshToken={refreshToken} />
    </>
  );
}
function Events() {
  const c = useFeature();
  const [page, setPage] = useState(1);
  const scope = useScope();
  useEffect(
    () => setPage(1),
    [c.siteId, c.range.startAt, c.range.endAt, JSON.stringify(c.filters)],
  );
  const query = useWebsiteData(
    ['events-rich', page],
    'analytics',
    { ...scope, kind: 'events', page },
    true,
    true,
  );
  const timeline = useWebsiteData(['event-series'], 'events/series', scope);
  const d = query.data,
    t = d?.totals;
  const points: any[] = timeline.data || [];
  const labels = [...new Set(points.map(r => r.t))];
  const names = [...new Set(points.map(r => r.x))];
  return (
    <>
      <Metrics
        loading={!!query.isPending}
        items={[
          ['事件触发次数', t ? n(t.total) : null, '当前期间'],
          ['事件种类', t ? n(t.types) : null, '按事件名称聚合'],
          ['关联独立访客', t ? n(t.visitors) : null, '事件触发访客'],
          ['带属性事件', t ? n(t.withProperties) : null, '有属性的事件触发次数'],
        ]}
      />
      <Panel title="事件触发趋势" subtitle="日期范围与下方明细一致。">
        <QueryState readOnly query={timeline}>
          <Chart
            labels={labels}
            series={names.map(name => ({
              name,
              values: labels.map(t =>
                points.filter(r => r.x === name && r.t === t).reduce((s, r) => s + Number(r.y), 0),
              ),
            }))}
          />
        </QueryState>
      </Panel>
      <Panel title="事件列表" subtitle="点击事件名称查看属性分布与关联访问记录。">
        <QueryState readOnly query={query}>
          <Table
            search
            columns={['事件名称', '触发次数', '触发访客', '属性数', '最近触发', '操作']}
            numeric={[1, 2, 3]}
            page={page}
            pages={Math.ceil((d?.count || 0) / 100)}
            onPage={setPage}
            rows={(d?.rows || []).map((r: any) => [
              <ActionLink page="event-detail" params={{ eventName: r.name }} key={r.name}>
                <code>{r.name}</code>
              </ActionLink>,
              n(r.triggers),
              n(r.visitors),
              n(r.properties),
              date(r.lastAt, scope.timezone),
              <ActionLink page="event-detail" params={{ eventName: r.name }} key={r.name}>
                属性
              </ActionLink>,
            ])}
          />
        </QueryState>
      </Panel>
    </>
  );
}
function EventDetail() {
  const c = useFeature();
  const name = c.query.eventName || '';
  const [property, setProperty] = useState('');
  const scope = useScope({ eventName: name, kind: 'events', propertyName: property });
  const query = useWebsiteData(['event-detail', name, property], 'analytics', scope, !!name, true);
  const d = query.data,
    t = d?.totals;
  const properties = [...new Set<string>((d?.properties || []).map((r: any) => r.name))];
  useEffect(() => {
    if (d && !properties.includes(property)) setProperty(properties[0] || '');
  }, [!!d, JSON.stringify(properties)]);
  if (!name)
    return (
      <Notice>
        请从事件列表选择一个事件。<LinkButton page="events">返回事件列表</LinkButton>
      </Notice>
    );
  const present = (d?.properties || [])
    .filter((r: any) => r.name === property)
    .reduce((s: number, r: any) => s + Number(r.total), 0);
  const values = [...(d?.values || [])];
  if (t && property && present < t.total)
    values.push({ value: null, dataType: 0, total: t.total - present });
  const types: Record<number, string> = {
    0: '缺失',
    1: '字符串',
    2: '数值',
    3: '布尔值',
    4: '日期',
    5: '数组',
  };
  return (
    <>
      <div className="row between">
        <div>
          <Badge tone="blue">事件</Badge> <code>{name}</code>
        </div>
        <LinkButton page="events">返回事件列表</LinkButton>
      </div>
      <Metrics
        loading={!!query.isPending}
        items={[
          ['触发次数', t ? n(t.total) : null, '当前期间'],
          ['触发访客', t ? n(t.visitors) : null, '独立访客'],
          [
            '属性字段',
            d ? n(properties.length) : null,
            properties.join('、') || '当前事件未提供属性',
          ],
          ['最近触发', t ? date(t.lastAt, c.range.timezone) : null, '当前期间'],
        ]}
      />
      <QueryState readOnly query={query}>
        <div className="two">
          <Panel
            title="事件属性分布"
            subtitle={`${property || '未提供属性'} 的各属性值对应触发次数。`}
            actions={
              <Tabs items={properties.map(p => [p, p])} active={property} onChange={setProperty} />
            }
          >
            <Chart
              type="bar"
              horizontal
              labels={values.map(r => r.value ?? '未提供')}
              series={[{ name: '触发次数', values: values.map(r => Number(r.total)) }]}
            />
          </Panel>
          <Panel title="属性值明细" subtitle="值类型和缺失状态分别显示。">
            <Table
              columns={['属性值', '类型', '触发次数', '占比']}
              rows={values.map(r => [
                r.value == null ? <Badge>未提供</Badge> : r.value,
                types[r.dataType] || '未识别类型',
                n(r.total),
                percentage(r.total, t?.total),
              ])}
              numeric={[2, 3]}
            />
            {d?.limited && <Notice>属性值较多，当前显示前 100 项；占比使用全部事件作分母。</Notice>}
          </Panel>
        </div>
      </QueryState>
      <SessionTable title="关联访问记录" params={{ drill_event: `eq.${name}` }} />
    </>
  );
}
function Sessions() {
  const c = useFeature();
  const [tab, setTab] = useState(c.query.tab || 'activity'),
    [page, setPage] = useState(1);
  useEffect(() => {
    setTab(c.query.tab || 'activity');
    setPage(1);
  }, [c.query.tab, JSON.stringify(c.filters)]);
  useEffect(
    () => setPage(1),
    [c.siteId, c.range.startAt, c.range.endAt, JSON.stringify(c.filters)],
  );
  const scope = useScope({ kind: tab === 'properties' ? 'session-properties' : 'sessions', page });
  const query = useWebsiteData(
    ['session-tab', tab, page],
    'analytics',
    scope,
    tab !== 'activity',
    true,
  );
  return (
    <>
      <Tabs
        items={[
          ['activity', '访问活动'],
          ['visitors', '访客'],
          ['properties', '会话属性'],
        ]}
        active={tab}
        onChange={t => {
          setTab(t);
          setPage(1);
        }}
      />
      {tab === 'activity' ? (
        <SessionTable />
      ) : (
        <Panel
          title={tab === 'properties' ? '会话属性' : '访客记录'}
          subtitle={
            tab === 'properties' ? '按已提供的身份属性查看人群。' : '以脱敏访客标识聚合访问。'
          }
        >
          <QueryState readOnly query={query}>
            <Table
              search
              columns={
                tab === 'properties'
                  ? ['属性名称', '属性值', '关联会话', '操作']
                  : ['访客', '最近访问', '会话次数', '访问页面', '操作']
              }
              rows={(query.data?.rows || []).map((r: any) =>
                tab === 'properties'
                  ? [
                      r.name,
                      r.value ?? '未提供',
                      n(r.sessions),
                      <ActionLink
                        page="sessions"
                        key={`${r.name}:${r.value}`}
                        params={{
                          spf0: `${r.dataType}.eq.${encodeURIComponent(r.name).replaceAll('.', '%2E')}.${r.value}`,
                          tab: 'activity',
                        }}
                      >
                        详情
                      </ActionLink>,
                    ]
                  : [
                      visitor(r.id),
                      date(r.lastAt, c.range.timezone),
                      n(r.visits),
                      r.urlPath || '未提供',
                      <ActionLink page="session-detail" params={{ id: r.id }} key={r.id}>
                        详情
                      </ActionLink>,
                    ],
              )}
              numeric={[2]}
              page={page}
              pages={
                tab === 'properties'
                  ? query.data?.more
                    ? page + 1
                    : page
                  : Math.ceil((query.data?.count || 0) / 25)
              }
              onPage={setPage}
            />
          </QueryState>
        </Panel>
      )}
      <Notice>访问记录保留时间、环境、来源和行为时间线，访客标识脱敏展示。</Notice>
    </>
  );
}
function SessionDetail() {
  const c = useFeature();
  const id = c.route.id;
  const [page, setPage] = useState(1);
  useEffect(
    () => setPage(1),
    [c.siteId, c.range.startAt, c.range.endAt, JSON.stringify(c.filters)],
  );
  const scope = useScope({ kind: 'session', sessionId: id, page });
  const query = useWebsiteData(['session-timeline', id, page], 'analytics', scope, !!id, true);
  const record = useWebsiteData(['session-record', id], `sessions/${id}`, {}, !!id);
  const props = useWebsiteData(['session-props', id], `sessions/${id}/properties`, {}, !!id);
  const replays = useWebsiteData(
    ['session-replays', id],
    `sessions/${id}/replays`,
    useScope(),
    !!id,
  );
  if (!id)
    return (
      <Notice>
        请选择访问记录后查看详情。<LinkButton page="sessions">返回访问记录</LinkButton>
      </Notice>
    );
  const r = record.data,
    rows = query.data?.rows || [],
    t = query.data?.totals,
    first = t
      ? { createdAt: t.firstAt, referrerDomain: t.referrerDomain, urlPath: t.entryPath }
      : undefined,
    last = t ? { createdAt: t.lastAt, urlPath: t.exitPath } : undefined,
    replay = rowsOf<any>(replays.data)[0];
  return (
    <>
      <div className="row between">
        <div className="row">
          <Badge tone="blue">访问详情</Badge>
          <strong>{visitor(id)}</strong>
          <span className="muted">{date(first?.createdAt, c.range.timezone)}</span>
        </div>
        <div className="actions">
          <LinkButton page="sessions">返回访问记录</LinkButton>
          {replay ? (
            <LinkButton page="replay-player" params={{ id: replay.id }}>
              查看回放
            </LinkButton>
          ) : (
            <Button disabled>
              {replays.isPending ? '正在读取回放' : replays.error ? '回放读取失败' : '未采集回放'}
            </Button>
          )}
        </div>
      </div>
      {replays.error && (
        <QueryState readOnly query={replays}>
          {null}
        </QueryState>
      )}
      <Metrics
        loading={!!record.isPending}
        items={[
          ['页面访问', t ? n(t.views) : null, '当前期间'],
          ['事件触发', t ? n(t.events) : null, '当前期间'],
          ['会话时长', duration(t?.seconds), '首次至最近一次行为'],
          [
            '访问来源',
            first ? classifyEntrySource({ referrer: first.referrerDomain }).source : null,
            '引荐域名识别',
            'blue',
          ],
        ]}
      />
      <div className="narrow-wide">
        <Panel title="访客信息" subtitle="环境信息与已提供的会话属性。">
          <Body>
            <QueryState readOnly query={record}>
              <Definition
                items={[
                  ['地域', [r?.city, r?.country].filter(Boolean).join('，') || '未提供'],
                  ['设备', r?.device || '未提供'],
                  ['浏览器', r?.browser || '未提供'],
                  ['操作系统', r?.os || '未提供'],
                  ['语言', r?.language || '未提供'],
                  ['引荐来源', first?.referrerDomain || '直接访问'],
                  ['入口页面', first?.urlPath || '未提供'],
                  ['出口页面', last?.urlPath || '未提供'],
                ]}
              />
            </QueryState>
            <hr className="divider" />
            <h3>会话属性</h3>
            <div style={{ marginTop: 12 }}>
              <QueryState readOnly query={props}>
                <Definition
                  items={(props.data || []).map((p: any) => [
                    p.dataKey,
                    p.stringValue ?? p.numberValue ?? p.dateValue ?? <Badge>未提供</Badge>,
                  ])}
                />
                {!props.isPending && !props.data?.length && <Notice>当前会话未提供属性。</Notice>}
              </QueryState>
            </div>
          </Body>
        </Panel>
        <Panel title="访问时间线" subtitle="按当前期间的发生时间排列页面与事件。">
          <Body>
            <QueryState readOnly query={query}>
              <ul className="timeline">
                {query.isPending &&
                  Array.from({ length: 5 }, (_, i) => (
                    <li key={`loading-${i}`} aria-hidden="true">
                      <span className="skeleton" />
                    </li>
                  ))}
                {rows.map((e: any) => (
                  <li key={e.eventId}>
                    <time className="timeline-time">{date(e.createdAt, c.range.timezone)}</time>
                    <strong>{e.eventName || e.urlPath}</strong>
                    <p>
                      {e.eventName ? '事件触发' : '页面访问'}
                      {e.urlQuery ? ` · ${e.urlQuery}` : ''}
                    </p>
                    {e.eventName && (
                      <ActionLink page="event-detail" params={{ eventName: e.eventName }}>
                        查看事件属性
                      </ActionLink>
                    )}
                  </li>
                ))}
              </ul>
              {!query.isPending && !rows.length && <Notice>当前范围没有访问行为。</Notice>}
              {(query.data?.more || page > 1) && (
                <div className="actions">
                  <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                    上一页
                  </Button>
                  <Button disabled={!query.data?.more} onClick={() => setPage(page + 1)}>
                    下一页
                  </Button>
                </div>
              )}
            </QueryState>
          </Body>
        </Panel>
      </div>
    </>
  );
}

const fields: [string, string][] = [
  ['referrer', '来源'],
  ['country', '国家 / 地区'],
  ['path', '页面路径'],
  ['device', '设备'],
  ['browser', '浏览器'],
  ['channel', '渠道'],
  ['sessionPlan', '会话属性 · plan'],
];
function Conditions({
  value,
  onChange,
  match,
  setMatch,
  cohort = false,
}: {
  value: AnalysisCondition[];
  onChange: (v: AnalysisCondition[]) => void;
  match: string;
  setMatch: (v: string) => void;
  cohort?: boolean;
}) {
  return (
    <div className="condition-group" data-dirty-actions>
      <div className="row between" style={{ marginBottom: 16 }}>
        <h3>访问条件</h3>
        <Select
          label="匹配规则"
          name="match"
          options={[
            ['all', '满足全部条件 (AND)'],
            ['any', '满足任一条件 (OR)'],
          ]}
          value={match}
          onChange={e => setMatch(e.target.value)}
        />
      </div>
      <div>
        {value.map((row, i) => (
          <div className="condition" key={i}>
            <Select
              label="字段"
              options={fields.map(([value, label]) => ({
                value,
                label,
                disabled: cohort && value === 'sessionPlan',
              }))}
              value={row.name}
              onChange={e =>
                onChange(value.map((c, j) => (i === j ? { ...c, name: e.target.value } : c)))
              }
            />
            <Select
              label="运算符"
              options={[
                ['eq', '等于'],
                ['neq', '不等于'],
                ['c', '包含'],
                ['dnc', '不包含'],
                ['re', '正则匹配'],
              ]}
              value={row.operator}
              onChange={e =>
                onChange(value.map((c, j) => (i === j ? { ...c, operator: e.target.value } : c)))
              }
            />
            <Field
              label="值"
              value={row.value}
              required
              onChange={e =>
                onChange(value.map((c, j) => (i === j ? { ...c, value: e.target.value } : c)))
              }
            />
            <Button
              className="btn icon-btn"
              aria-label={`移除条件 ${i + 1}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Icon name="close" />
            </Button>
          </div>
        ))}
      </div>
      <Button onClick={() => onChange([...value, { name: 'referrer', operator: 'eq', value: '' }])}>
        <Icon name="plus" />
        添加条件
      </Button>
    </div>
  );
}
function queryConditions(query: Record<string, string>): AnalysisCondition[] {
  return Object.entries(query)
    .filter(([key]) => fields.some(([f]) => key.replace(/\d+$/, '') === f))
    .map(([key, v]) => {
      const m = v.match(/^([a-z]+)\.(.*)$/);
      return { name: key.replace(/\d+$/, ''), operator: m?.[1] || 'eq', value: m?.[2] || v };
    });
}
function FilterEditor({
  kind = 'filters',
}: {
  kind?: 'filters' | 'segment-editor' | 'cohort-editor';
}) {
  const c = useFeature(),
    action = useAction();
  const isCohort = kind === 'cohort-editor',
    id = c.route.id;
  const record = useWebsiteData(
    ['definition', id],
    `segments/${id}`,
    {},
    !!id && kind !== 'filters',
  );
  const initialProps = decodePropertyConditions(c.filters);
  const [conditions, setConditions] = useState<AnalysisCondition[]>([
    ...queryConditions(c.filters),
    ...(isCohort ? [] : initialProps.plans),
  ]);
  const [match, setMatch] = useState(c.filters.match || 'all'),
    [property, setProperty] = useState(initialProps.property),
    [propertyValue, setPropertyValue] = useState(initialProps.value),
    [preservedProps, setPreservedProps] = useState<any[]>(initialProps.preserved),
    [preview, setPreview] = useState<number | null>(null);
  useEffect(() => {
    if (record.data) {
      const allProps = record.data.parameters.sessionPropertyFilters || [];
      const plans = allProps.filter((p: any) => p.propertyName === 'plan' && p.dataType === 1);
      setConditions([
        ...(record.data.parameters.filters || []),
        ...plans.map((p: any) => ({ name: 'sessionPlan', operator: p.operator, value: p.value })),
      ]);
      setMatch(record.data.parameters.match || 'all');
      const others = allProps.filter((p: any) => !plans.includes(p));
      const f = others.find((p: any) => p.dataType === 1 && p.operator === 'eq');
      setPreservedProps(others.filter((p: any) => p !== f));
      setProperty(f?.propertyName || '');
      setPropertyValue(f?.value || '');
    }
  }, [record.data]);
  const definitionParams = () =>
    savedConditionParameters(
      isCohort ? conditions.filter(c => c.name !== 'sessionPlan') : conditions,
      match,
      isCohort ? '' : property,
      isCohort ? '' : propertyValue,
      isCohort ? [] : preservedProps,
    );
  const previewMatches = async () => {
    const params = conditionsToQuery(conditions, match, property, propertyValue, preservedProps);
    const stats = await c.api.get(`/websites/${c.siteId}/stats`, { ...c.range, ...params });
    setPreview(Number(stats.visitors));
  };
  const form = (
    <Form
      disabled={kind !== 'filters' && !canManage(c)}
      busy={action.busy}
      error={action.error}
      submitLabel={kind === 'filters' ? '应用筛选' : isCohort ? '保存行为人群' : '保存分群'}
      cancel={
        kind !== 'filters' ? (
          <LinkButton page={isCohort ? 'cohorts' : 'segments'}>取消</LinkButton>
        ) : undefined
      }
      onSubmit={async values => {
        if (kind === 'filters') {
          c.navigate('sessions', {
            ...Object.fromEntries(Object.keys(c.filters).map(key => [key, undefined])),
            ...conditionsToQuery(conditions, match, property, propertyValue, preservedProps),
            date: `range:${c.range.startAt}:${c.range.endAt}:${c.range.unit}`,
          });
          return;
        }
        if (!canManage(c)) throw new Error(isCohort ? '无权保存此行为人群' : '无权保存此分群');
        const parameters = {
          ...definitionParams(),
          ...(isCohort
            ? {
                action: { type: values.actionType, value: values.actionValue },
                dateRange: values.dateRange,
              }
            : {}),
        };
        await action.run(
          () =>
            c.api.post(`/websites/${c.siteId}/segments${id ? `/${id}` : ''}`, {
              name: values.name,
              type: isCohort ? 'cohort' : 'segment',
              parameters,
            }),
          isCohort ? '行为人群已保存' : '分群已保存',
        );
        c.navigate(isCohort ? 'cohorts' : 'segments');
      }}
    >
      {kind !== 'filters' && (
        <Field
          label={isCohort ? '行为人群名称' : '分群名称'}
          name="name"
          required
          maxLength={200}
          defaultValue={record.data?.name || ''}
        />
      )}
      {isCohort && (
        <div className="form-grid">
          <Select
            label="行为类型"
            name="actionType"
            options={[
              ['path', '访问页面'],
              ['event', '触发事件'],
            ]}
            defaultValue={record.data?.parameters.action?.type || 'event'}
          />
          <Field
            label="行为值"
            name="actionValue"
            required
            defaultValue={record.data?.parameters.action?.value || ''}
          />
          <Select
            label="日期范围"
            name="dateRange"
            options={[
              ['7day', '过去 7 天'],
              ['30day', '过去 30 天'],
              ['0month', '本月'],
              ...(!['7day', '30day', '0month'].includes(
                record.data?.parameters.dateRange || '30day',
              )
                ? [
                    [
                      record.data.parameters.dateRange,
                      `已保存：${record.data.parameters.dateRange}`,
                    ] as [string, string],
                  ]
                : []),
            ]}
            defaultValue={record.data?.parameters.dateRange || '30day'}
          />
        </div>
      )}
      <Conditions
        value={conditions}
        onChange={setConditions}
        match={match}
        setMatch={setMatch}
        cohort={isCohort}
      />
      {isCohort && (
        <p className="field-help">行为人群暂不支持会话属性条件；该字段保留为不可选状态。</p>
      )}
      {!isCohort && (
        <div className={kind === 'filters' ? 'condition-group' : 'form-grid'}>
          {kind === 'filters' && <h3 style={{ marginBottom: 12 }}>会话属性</h3>}
          <div className="form-grid">
            <Field
              label={kind === 'filters' ? '属性名称' : '会话属性（可选）'}
              value={property}
              onChange={e => setProperty(e.target.value)}
            />
            <Field
              label="属性值"
              value={propertyValue}
              onChange={e => setPropertyValue(e.target.value)}
            />
          </div>
          {kind === 'filters' && <p className="field-help">会话属性条件与访问条件共同限定结果。</p>}
        </div>
      )}
      {isCohort ? (
        <Notice>行为人群的附加条件使用来源、地域、设备等维度。动作由上方字段单独定义。</Notice>
      ) : (
        <>
          <div className="row">
            <Button onClick={previewMatches}>预览匹配人数</Button>
            {kind === 'filters' && (
              <Button
                data-dirty-action="true"
                onClick={() => {
                  setConditions([]);
                  setProperty('');
                  setPropertyValue('');
                  setPreservedProps([]);
                  setMatch('all');
                  setPreview(null);
                }}
              >
                重置条件
              </Button>
            )}
          </div>
          <p className="blue num">
            {preview == null ? '点击预览计算当前匹配访客' : `匹配 ${n(preview)} 位访客`}
          </p>
        </>
      )}
    </Form>
  );
  const editor = (
    <Panel
      title={
        kind === 'filters'
          ? '条件筛选'
          : isCohort
            ? id
              ? '编辑行为人群'
              : '创建行为人群'
            : id
              ? '编辑已保存分群'
              : '创建已保存分群'
      }
      subtitle={
        kind === 'filters'
          ? '访问条件按全部或任一组合，会话属性单独设置。应用后查看匹配的访问记录。'
          : isCohort
            ? '指定时间内完成一个页面访问或事件行为。'
            : '名称、匹配逻辑、访问条件与会话属性。'
      }
    >
      <Body>
        {id && record.isPending ? (
          <QueryState query={record}>{null}</QueryState>
        ) : id && record.error ? (
          <QueryState query={record}>{null}</QueryState>
        ) : (
          <div key={`${id || 'new'}:${record.data?.id || ''}:${c.siteId}`}>{form}</div>
        )}
      </Body>
    </Panel>
  );
  return kind === 'filters' ? (
    <div className="wide-narrow">
      {editor}
      <Panel title="保存与复用" subtitle="将当前条件加入已保存分群。">
        <Body>
          <p className="muted">日期范围变化后，分群按相同条件重新计算。</p>
          <div className="form-actions">
            <LinkButton
              page="segment-editor"
              params={{
                ...Object.fromEntries(Object.keys(c.filters).map(key => [key, undefined])),
                ...conditionsToQuery(conditions, match, property, propertyValue, preservedProps),
              }}
              primary
            >
              保存为分群
            </LinkButton>
          </div>
          <hr className="divider" />
          <Definition
            items={[
              ['当前网站', c.site?.name],
              [
                '日期',
                `${date(c.range.startAt, c.range.timezone)} 至 ${date(c.range.endAt, c.range.timezone)}`,
              ],
              ['当前逻辑', match === 'all' ? '全部匹配 (AND)' : '任一匹配 (OR)'],
            ]}
          />
        </Body>
      </Panel>
    </div>
  ) : (
    editor
  );
}
function Audiences({ cohort = false }: { cohort?: boolean }) {
  const c = useFeature();
  const type = cohort ? 'cohort' : 'segment';
  const query = useData(
    ['audience-list', type],
    signal => getAllFeatureRows(`/websites/${c.siteId}/segments`, { type }, signal),
    !!c.siteId,
  );
  const [results, setResults] = useState<Record<string, any>>({});
  useEffect(() => {
    const ctrl = new AbortController();
    setResults({});
    for (const row of query.data || [])
      c.api
        .get(
          `/websites/${c.siteId}/stats`,
          { ...c.range, ...c.filters, [type]: row.id },
          ctrl.signal,
        )
        .then(stats => {
          if (!ctrl.signal.aborted) setResults(r => ({ ...r, [row.id]: stats }));
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setResults(r => ({ ...r, [row.id]: { error: true } }));
        });
    return () => ctrl.abort();
  }, [query.data, c.siteId, c.range.startAt, c.range.endAt, JSON.stringify(c.filters)]);
  const total = useWebsiteData(['audience-total'], 'stats', useScope());
  return (
    <>
      <Panel
        title={cohort ? '行为人群' : '已保存分群'}
        subtitle={
          cohort ? '以指定时间内完成某个行为的访客为分析人群。' : '动态匹配访问维度和会话属性。'
        }
        actions={
          canManage(c) && (
            <LinkButton primary page={cohort ? 'cohort-editor' : 'segment-editor'}>
              <Icon name="plus" />
              创建{cohort ? '行为人群' : '分群'}
            </LinkButton>
          )
        }
      >
        <QueryState readOnly query={query}>
          <Table
            search
            columns={
              cohort
                ? ['行为人群名称', '行为与期间', '访客', '更新时间', '操作']
                : ['分群名称', '条件摘要', '匹配访客', '占比', '操作']
            }
            rows={(query.data || []).map((r: any) => [
              r.name,
              cohort
                ? `${r.parameters.action?.value || '未提供'} · ${r.parameters.dateRange}`
                : (r.parameters.filters || [])
                    .map(
                      (f: any) =>
                        `${fields.find(([k]) => k === f.name)?.[1] || f.name} ${f.operator} ${f.value}`,
                    )
                    .join(r.parameters.match === 'any' ? ' 或 ' : ' 且 ') || '全部访客',
              results[r.id]?.error
                ? '读取失败'
                : results[r.id]
                  ? n(results[r.id].visitors)
                  : '正在加载',
              cohort
                ? date(r.updatedAt || r.createdAt, c.range.timezone)
                : results[r.id]?.error || total.error
                  ? '读取失败'
                  : results[r.id] && total.data
                    ? percentage(results[r.id].visitors, total.data.visitors)
                    : '未提供',
              <ActionLink
                page={cohort ? 'cohort-editor' : 'segment-editor'}
                params={{ id: r.id }}
                key={r.id}
              >
                {canManage(c)
                  ? cohort
                    ? '编辑行为人群'
                    : '编辑分群'
                  : cohort
                    ? '查看行为人群'
                    : '查看分群'}
              </ActionLink>,
            ])}
            numeric={cohort ? [2] : [2, 3]}
          />
        </QueryState>
      </Panel>
      {!cohort && total.error && (
        <QueryState readOnly query={total}>
          {null}
        </QueryState>
      )}
      {cohort ? (
        <div className="two">
          <Panel title="行为人群与留存" subtitle="观察完成行为后的访客是否返回。">
            <Body>
              <p className="muted">行为人群定义保留行为、日期范围和访问条件。</p>
              <div className="form-actions">
                <LinkButton page="retention">查看留存矩阵</LinkButton>
              </div>
            </Body>
          </Panel>
          <Panel title="行为人群与路径" subtitle="观察人群的访问行为组合。">
            <Body>
              <p className="muted">在旅程中选择已保存的人群条件。</p>
              <div className="form-actions">
                <LinkButton page="journeys">查看访问旅程</LinkButton>
              </div>
            </Body>
          </Panel>
        </div>
      ) : (
        <Notice>分群保存条件定义，不固定一份访客列表。可从分析页复用并按所选日期重新计算。</Notice>
      )}
    </>
  );
}

function Retention() {
  const c = useFeature();
  const initial = formatInTimeZone(c.range.endAt, c.range.timezone, 'yyyy-MM');
  const audience = c.filters.cohort
    ? `cohort:${c.filters.cohort}`
    : c.filters.segment
      ? `segment:${c.filters.segment}`
      : '';
  const [month, setMonth] = useState(initial),
    [detail, setDetail] = useState<any>(null),
    [info, setInfo] = useState(false);
  const months = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(`${initial}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - i);
    const value = date.toISOString().slice(0, 7);
    return [value, `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`] as [string, string];
  });
  const people = useData(
    ['retention-audiences'],
    async signal => {
      const [segments, cohorts] = await Promise.all(
        ['segment', 'cohort'].map(type =>
          getAllFeatureRows<any>(`/websites/${c.siteId}/segments`, { type }, signal),
        ),
      );
      return [
        ...segments.map(r => ({ ...r, type: 'segment' })),
        ...cohorts.map(r => ({ ...r, type: 'cohort' })),
      ];
    },
    !!c.siteId,
  );
  const startAt = +fromZonedTime(`${month}-01T00:00:00`, c.range.timezone);
  const next = new Date(`${month}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const endAt = Math.min(
    Date.now(),
    +fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, c.range.timezone) - 1,
  );
  const { segment: ignoredSegment, cohort: ignoredCohort, ...rest } = c.filters;
  const [type, id] = audience.split(':');
  const scope = { ...c.range, startAt, endAt, ...rest, ...(id ? { [type]: id } : {}) };
  const query = useWebsiteData(['retention', month, audience], 'retention', scope);
  const rows: any[] = query.data || [];
  const cohorts = rows.filter(r => Number(r.day) === 0);
  const cutoff = completedObservationDate(endAt, c.range.timezone);
  const days = [1, 2, 3, 4, 5, 6, 7, 14, 21, 28];
  const summary = days
    .filter(d => [1, 7, 28].includes(d))
    .map(d => retentionSummary(rows, d, cutoff));
  return (
    <>
      <div className="row between">
        <div className="row">
          <Select
            label="月份"
            value={month}
            options={months}
            onChange={e => setMonth(e.target.value)}
          />
          <Select
            label="人群"
            value={audience}
            options={[
              ['', '全部访客'],
              ...(audience && !(people.data || []).some(r => `${r.type}:${r.id}` === audience)
                ? [
                    {
                      value: audience,
                      label: `${type === 'cohort' ? '所选人群' : '所选分群'}（${people.isPending ? '正在读取' : people.error ? '读取失败' : '不可用'}）`,
                      disabled: true,
                    },
                  ]
                : []),
              ...(people.data || []).map(r => [`${r.type}:${r.id}`, r.name] as [string, string]),
            ]}
            onChange={e => {
              const [type, id] = e.target.value.split(':');
              c.updateQuery({
                cohort: type === 'cohort' ? id : undefined,
                segment: type === 'segment' ? id : undefined,
              });
            }}
          />
        </div>
        <Button onClick={() => setInfo(true)}>口径说明</Button>
      </div>
      <Metrics
        loading={!!query.isPending}
        items={[
          [
            '入组访客',
            query.data ? n(cohorts.reduce((s, r) => s + Number(r.visitors), 0)) : null,
            '按所选期间首次访问日期分组',
          ],
          ...summary.map(
            (s, i) =>
              [
                i === 0 ? '次日留存' : i === 1 ? '第 7 天留存' : '第 28 天留存',
                s.percentage == null ? '待观察' : `${s.percentage.toFixed(2)}%`,
                '完整观察队列',
              ] as [string, string, string],
          ),
        ]}
      />
      <Panel
        title="日队列留存矩阵"
        subtitle="点击单元格查看分子、分母及关联记录。未到观察日的格子显示“待观察”。"
      >
        <QueryState readOnly query={query}>
          <div className="table-wrap">
            <table className="heat-matrix">
              <thead>
                <tr>
                  <th>入组日期 / 人数</th>
                  {days.map(d => (
                    <th key={d}>第 {d} 天</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.isPending
                  ? Array.from({ length: 5 }, (_, index) => (
                      <tr key={index} aria-hidden="true">
                        {['date', ...days].map(day => (
                          <td key={day}>
                            <span className="skeleton" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : cohorts.map(cohort => {
                      const day = String(cohort.date).slice(0, 10);
                      return (
                        <tr key={day}>
                          <td>
                            <strong>{day.slice(5)}</strong>
                            <small style={{ display: 'block' }}>{n(cohort.visitors)} 位访客</small>
                          </td>
                          {days.map(d => {
                            const target = new Date(`${day}T00:00:00Z`);
                            target.setUTCDate(target.getUTCDate() + d);
                            if (target.toISOString().slice(0, 10) > cutoff)
                              return (
                                <td key={d}>
                                  <span
                                    className="heat-cell unobserved"
                                    style={{ display: 'block' }}
                                  >
                                    待观察
                                  </span>
                                </td>
                              );
                            const returned = Number(
                              rows.find(
                                r => String(r.date).slice(0, 10) === day && Number(r.day) === d,
                              )?.returnVisitors || 0,
                            );
                            const pct = (returned / Number(cohort.visitors)) * 100;
                            return (
                              <td key={d}>
                                <button
                                  className="heat-cell"
                                  style={{ background: `rgba(15,98,254,${pct / 90 + 0.06})` }}
                                  aria-label={`${day} 入组，第 ${d} 天，留存 ${pct.toFixed(2)}%`}
                                  onClick={() =>
                                    setDetail({
                                      day,
                                      date: day,
                                      offset: d,
                                      total: Number(cohort.visitors),
                                      returned,
                                    })
                                  }
                                >
                                  {pct.toFixed(2)}%
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
          {!query.isPending && !cohorts.length && <Notice>当前月份与人群条件没有入组访客。</Notice>}
          <div className="table-footer">
            <span>深浅表示留存比例，百分比同时显示。</span>
            <span>观察截止：{cutoff}</span>
          </div>
        </QueryState>
      </Panel>
      <Notice>
        按所选期间首次访问日期入组，以第 N 天再次访问衡量留存。汇总只统计已完整观察的队列；0%
        与待观察分别表达。
      </Notice>
      {info && (
        <Drawer title="留存计算口径" onClose={() => setInfo(false)}>
          <Definition
            items={[
              ['入组', '按所选期间首次访问日期分组'],
              ['留存', '第 N 天再次访问的人数'],
              ['分母', '当日入组访客数'],
              ['待观察', '尚未达到对应观察日'],
              ['零值', '已经观察，返回人数为 0'],
            ]}
          />
          <hr className="divider" />
          <Notice>汇总按入组人数加权，仅纳入观察日已完整结束的队列。</Notice>
        </Drawer>
      )}
      {detail && (
        <Drawer title="留存单元格" onClose={() => setDetail(null)}>
          <Definition
            items={[
              ['入组日期', detail.date],
              ['观察时间', `第 ${detail.offset} 天`],
              ['入组访客', n(detail.total)],
              ['返回访客', n(detail.returned)],
              ['留存比例', percentage(detail.returned, detail.total)],
            ]}
          />
          <hr className="divider" />
          <LinkButton
            page="sessions"
            params={{
              ...rest,
              segment: undefined,
              cohort: undefined,
              ...(id ? { [type]: id } : {}),
              retentionDate: detail.date,
              retentionDay: detail.offset,
              date: `range:${startAt}:${endAt}:day`,
            }}
          >
            查看关联访问记录
          </LinkButton>
        </Drawer>
      )}
    </>
  );
}
function Journeys({ detail = false }: { detail?: boolean }) {
  const c = useFeature();
  const [conditions, setConditions] = useState({
    type: c.query.type || 'all',
    steps: Number(c.query.steps) || 3,
    startStep: c.query.startStep || '',
    endStep: c.query.endStep || '',
  });
  const scope = useScope({ ...conditions, ...(detail ? { sequence: c.query.sequence } : {}) });
  const [page, setPage] = useState(1);
  useEffect(
    () => setPage(1),
    [
      c.siteId,
      c.range.startAt,
      c.range.endAt,
      JSON.stringify(c.filters),
      JSON.stringify(conditions),
    ],
  );
  const query = useWebsiteData(
    ['journey-rich', scope, page],
    detail ? 'journeys/details' : 'journeys',
    { ...scope, page },
    !detail || !!c.query.sequence,
    true,
  );
  const d = query.data as JourneyData;
  const rows = d?.rows || [];
  const nodes: any[] = [],
    links: any[] = [],
    nodeIds = new Set();
  for (const row of rows) {
    row.nodes.forEach((label, i) => {
      const name = `${i}:${label}`;
      if (!nodeIds.has(name)) {
        nodeIds.add(name);
        nodes.push({ name, label: { formatter: label } });
      }
      if (i)
        links.push({ source: `${i - 1}:${row.nodes[i - 1]}`, target: name, value: row.visitors });
    });
  }
  const graph = {
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'sankey',
        data: nodes,
        links,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'source', opacity: 0.16, curveness: 0.5 },
        left: 20,
        right: 110,
        top: 32,
        bottom: 30,
        layoutIterations: 32,
        nodeWidth: 14,
        nodeGap: 24,
        label: { fontSize: 11, color: '#697386' },
      },
    ],
  };
  if (detail) {
    if (!c.query.sequence)
      return (
        <Notice>
          请选择访问路径。<LinkButton page="journeys">返回访问旅程</LinkButton>
        </Notice>
      );
    const row = rows[0];
    return (
      <>
        <div className="row between">
          <h2>{row?.nodes.join(' → ') || '所选访问路径'}</h2>
          <LinkButton page="journeys" params={conditions}>
            返回访问旅程
          </LinkButton>
        </div>
        <QueryState readOnly query={query}>
          <Metrics
            items={[
              ['完成路径', row ? n(row.visitors) : '0', '独立访客'],
              [
                '路径占比',
                row ? percentage(row.visitors, d.visitors) : '—',
                row ? `${n(row.visitors)} / ${n(d.visitors)}` : '当前范围无匹配路径',
              ],
              ['平均完成时间', duration(row?.seconds), `${row?.nodes.length || 0} 步路径`],
              ['主要来源', row?.source || '直接访问', '按完成路径的访客数排序'],
            ]}
          />
          <Panel title="路径节点" subtitle="展示所选行为路径。">
            <Body>
              <ol className="timeline">
                {query.isPending &&
                  Array.from({ length: 3 }, (_, i) => (
                    <li key={`loading-${i}`} aria-hidden="true">
                      <span className="skeleton" />
                    </li>
                  ))}
                {row?.nodes.map((node, i) => (
                  <li key={`${i}:${node}`}>
                    <strong>{node}</strong>
                    <p>
                      {i === 0
                        ? '所选路径入口'
                        : i === row.nodes.length - 1
                          ? `${n(row.visitors)} 位访客完成所选路径`
                          : '所选路径中间节点'}
                    </p>
                  </li>
                ))}
              </ol>
              {!query.isPending && !row && (
                <Notice>当前条件没有匹配路径，请返回访问旅程调整条件。</Notice>
              )}
            </Body>
          </Panel>
          <Panel
            title="完成路径的访问记录"
            subtitle="与所选节点序列、类型、步数、日期及筛选条件一致。"
          >
            <Table
              columns={['访客', '访问时间', '地域', '来源', '当前页面', '页面数', '时长', '操作']}
              rows={(d?.sessions || []).map(r => [
                visitor(r.id),
                date(r.lastAt, c.range.timezone),
                [r.city, r.country].filter(Boolean).join('，') || '未提供',
                classifyEntrySource({ referrer: r.referrerDomain }).source,
                r.urlPath || '未提供',
                n(r.views),
                duration(r.seconds),
                <ActionLink page="session-detail" params={{ id: r.id }} key={r.id}>
                  详情
                </ActionLink>,
              ])}
              numeric={[5, 6]}
              page={page}
              pages={Math.ceil((d?.count || 0) / 25)}
              onPage={setPage}
            />
          </Panel>
        </QueryState>
      </>
    );
  }
  return (
    <>
      <Panel title="路径条件">
        <Body>
          <Form
            submitLabel="应用路径条件"
            onSubmit={async v =>
              setConditions({
                type: v.type,
                steps: Number(v.steps),
                startStep: v.startStep || '',
                endStep: v.endStep || '',
              })
            }
          >
            <div className="form-grid">
              <Select
                label="路径类型"
                name="type"
                options={[
                  ['all', '页面与事件'],
                  ['pages', '仅页面'],
                  ['events', '仅事件'],
                ]}
                defaultValue={conditions.type}
              />
              <Select
                label="步数"
                name="steps"
                options={[2, 3, 4, 5, 6, 7].map(n => [String(n), String(n)])}
                defaultValue={String(conditions.steps)}
              />
              <Field
                label="起点（可选）"
                name="startStep"
                defaultValue={conditions.startStep}
                help="输入当前类型中的页面或事件。"
              />
              <Field
                label="终点（可选）"
                name="endStep"
                defaultValue={conditions.endStep}
                help="留空时显示全部终点。"
              />
            </div>
          </Form>
        </Body>
      </Panel>
      <Panel
        title="从内容到转化的访问路径"
        subtitle="连线宽度代表访客量，下方路径明细可查看关联访问记录。"
      >
        <QueryState readOnly query={query}>
          {query.isPending || rows.length ? (
            <Chart
              type="sankey"
              height={400}
              labels={[]}
              series={[]}
              option={graph}
              onClick={event => {
                const row = rows.find(r =>
                  r.nodes.some((label, i) => `${i}:${label}` === event.name),
                );
                if (row)
                  c.navigate('path-detail', {
                    ...c.filters,
                    ...conditions,
                    sequence: JSON.stringify(row.nodes),
                    date: `range:${c.range.startAt}:${c.range.endAt}:${c.range.unit}`,
                  });
              }}
            />
          ) : (
            <Notice>当前条件没有匹配路径，请调整类型、起点或终点。</Notice>
          )}
        </QueryState>
      </Panel>
      <Panel title="路径明细" subtitle="按选定条件展示行为组合。">
        <QueryState readOnly query={query}>
          <Table
            search
            columns={['路径', '访客', '完成比例', '操作']}
            rows={rows.map(row => [
              row.nodes.join(' → '),
              n(row.visitors),
              percentage(row.visitors, d.visitors),
              <ActionLink
                key={JSON.stringify(row.nodes)}
                page="path-detail"
                params={{ ...conditions, sequence: JSON.stringify(row.nodes) }}
              >
                详情
              </ActionLink>,
            ])}
            numeric={[1, 2]}
          />
          {d?.limited && (
            <Notice>当前展示访客数最多的 100 条路径；完成比例使用全部匹配访客作分母。</Notice>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
function UTM() {
  const [dimension, setDimension] = useState('source');
  const scope = useScope();
  const summary = useWebsiteData(['utm-total'], 'analytics', { ...scope, kind: 'utm' }, true, true);
  const query = useWebsiteData(
    ['utm-dimension', dimension],
    'analytics',
    { ...scope, kind: 'utm', dimension },
    true,
    true,
  );
  const rows: any[] = query.data?.rows || [],
    total = Number(query.data?.dimensionTotal || 0);
  const c = useFeature();
  const goals = useData(
    ['utm-goal-list'],
    signal => getAllFeatureRows<any>(`/websites/${c.siteId}/goals`, {}, signal),
    !!c.siteId,
  );
  const selected = goals.data?.[0];
  const goal = useWebsiteData(
    ['utm-goal', selected?.id],
    `goals/${selected?.id}/analytics`,
    {
      ...scope,
      requireUtm: '1',
    },
    !!selected,
    true,
  );
  const filterNames: Record<string, string> = {
    source: 'utmSource',
    medium: 'utmMedium',
    campaign: 'utmCampaign',
    content: 'utmContent',
    term: 'utmTerm',
  };
  return (
    <>
      <Tabs
        items={[
          ['source', '来源 source'],
          ['medium', '媒介 medium'],
          ['campaign', '活动 campaign'],
          ['content', '内容 content'],
          ['term', '关键词 term'],
        ]}
        active={dimension}
        onChange={setDimension}
      />
      <QueryState readOnly query={summary}>
        <QueryState readOnly query={goals}>
          <QueryState readOnly query={{ ...goal, isPending: !!selected && !!goal.isPending }}>
            <Metrics
              loading={!!summary.isPending}
              items={[
                ['带 UTM 访问', summary.data ? n(summary.data.views) : null, '有至少一个 UTM 字段'],
                ['带 UTM 访客', summary.data ? n(summary.data.visitors) : null, '独立访客'],
                [
                  '已标记转化',
                  goals.error || goal.error
                    ? '读取失败'
                    : goals.isPending || (selected && goal.isPending)
                      ? '正在读取'
                      : selected && goal.data
                        ? n(goal.data.conversions)
                        : selected
                          ? '未提供'
                          : '尚未配置',
                  selected
                    ? `目标：${selected.name}`
                    : goals.error
                      ? '目标读取失败'
                      : '请先创建网站目标',
                ],
                ['字段缺失', '分别保留', '未提供字段不补推断'],
              ]}
            />
          </QueryState>
        </QueryState>
      </QueryState>
      <QueryState readOnly query={query}>
        <div className="two">
          <Chart
            title={`utm_${dimension} 分布`}
            subtitle="按当前维度的访问次数排序。"
            type="bar"
            horizontal
            labels={rows.map(r => r.utm || '未提供')}
            series={[{ name: '访问次数', values: rows.map(r => Number(r.views)) }]}
          />
          <Panel title="维度明细" subtitle="点击属性值筛选关联访问。">
            <Table
              columns={['属性值', '访问次数', '占比', '操作']}
              rows={rows.map(r => [
                r.utm || '未提供',
                n(r.views),
                percentage(r.views, total),
                <ActionLink
                  page="sessions"
                  params={{ [`drill_${filterNames[dimension]}`]: `eq.${r.utm}` }}
                  key={r.utm}
                >
                  访问
                </ActionLink>,
              ])}
              numeric={[1, 2]}
            />
          </Panel>
        </div>
      </QueryState>
      <Notice>
        UTM 活动按五个 URL 标记字段分别聚合。来源识别与 UTM 命名相互独立，AI 来源不会自动写入缺失的
        UTM 字段。
      </Notice>
    </>
  );
}
function Attribution() {
  const c = useFeature();
  const [settings, setSettings] = useState({ model: 'first-click', type: 'event', step: '' });
  const scope = useScope(settings);
  const query = useWebsiteData(
    ['attribution', settings],
    'analytics',
    { ...scope, kind: 'attribution' },
    !!settings.step,
    true,
  );
  const d = query.data;
  const rows = d?.referrer || [];
  const total = Number(d?.total?.visitors || 0),
    attributed = Number(d?.total?.attributed || 0);
  return (
    <>
      <Panel title="归因设置">
        <Body>
          <Form
            submitLabel="应用归因设置"
            onSubmit={async v => setSettings({ model: v.model, type: v.type, step: v.step })}
          >
            <div className="form-grid">
              <Select
                label="归因模型"
                name="model"
                options={[
                  ['first-click', '首次点击'],
                  ['last-click', '末次点击'],
                ]}
                defaultValue={settings.model}
              />
              <Select
                label="转化类型"
                name="type"
                options={[
                  ['path', '访问页面'],
                  ['event', '触发事件'],
                ]}
                defaultValue={settings.type}
              />
              <Field
                label="转化步骤"
                name="step"
                defaultValue={settings.step}
                required
                help="填写实际页面路径或事件名称。"
              />
            </div>
          </Form>
        </Body>
      </Panel>
      <Metrics
        loading={!!settings.step && !!query.isPending}
        items={[
          ['归因转化', d ? n(total) : null, `目标：${settings.step || '待设置'}`],
          [
            '归因模型',
            settings.model === 'first-click' ? '首次点击' : '末次点击',
            '两种模型使用相同转化访客集合',
          ],
          ['可归因转化', d ? n(attributed) : null, '有来源路径的转化访客'],
          ['直接 / 未知', d ? n(Math.max(0, total - attributed)) : null, '单独保留'],
        ]}
      />
      {settings.step ? (
        <QueryState readOnly query={query}>
          <Chart
            title="渠道贡献"
            subtitle="按所选模型分配转化访客。"
            type="bar"
            horizontal
            labels={rows.map((r: any) => r.name)}
            series={[{ name: '转化访客', values: rows.map((r: any) => Number(r.value)) }]}
          />
          <Panel title="归因明细" subtitle="上游归因按独立转化访客统计，同一访客的多次转化合并。">
            <Table
              search
              columns={['渠道', '转化次数', '贡献占比', '操作']}
              rows={rows.map((r: any) => [
                classifyEntrySource({ referrer: r.name }).source,
                n(r.value),
                percentage(r.value, total),
                <ActionLink
                  page="sessions"
                  params={{
                    attributionStep: settings.step,
                    attributionModel: settings.model,
                    attributionType: settings.type,
                    attributionSource: r.name,
                  }}
                  key={r.name}
                >
                  会话
                </ActionLink>,
              ])}
              numeric={[1, 2]}
            />
          </Panel>
        </QueryState>
      ) : (
        <Notice>填写转化步骤并应用设置后显示真实归因。</Notice>
      )}
      <Notice>
        AI 引荐按真实 referrer 识别。来源缺失时显示直接或未知。此表次数采用上游独立转化访客口径。
      </Notice>
    </>
  );
}
function Breakdown() {
  const [fields, setFields] = useState(['path', 'country']),
    [open, setOpen] = useState(false);
  const scope = useScope({ fields: JSON.stringify(fields) });
  const query = useWebsiteData(['breakdown', fields], 'breakdown', scope);
  const options: [string, string][] = [
    ['path', '页面路径'],
    ['country', '国家 / 地区'],
    ['browser', '浏览器'],
    ['device', '设备'],
    ['referrer', '来源'],
    ['event', '事件名称'],
  ];
  const labels = fields.map(f => options.find(([key]) => key === f)?.[1] || f);
  const rows: any[] = [...(query.data || [])].sort((a, b) => Number(b.views) - Number(a.views));
  return (
    <>
      <div className="row between">
        <div className="row">
          {labels.map(l => (
            <Badge key={l}>{l}</Badge>
          ))}
        </div>
        <Button primary onClick={() => setOpen(true)}>
          选择维度
        </Button>
      </div>
      <QueryState readOnly query={query}>
        <Chart
          title={`${labels.join(' × ')}的访问次数`}
          subtitle="维度组合按访问次数排序。"
          option={{ grid: { left: 150, right: 56, top: 34, bottom: 26 } }}
          type="bar"
          horizontal
          labels={rows.map(r => fields.map(f => r[f] || '未提供').join(' × '))}
          series={[{ name: '访问次数', values: rows.map(r => Number(r.views)) }]}
        />
        <Panel title="组合明细" subtitle="选择维度后，表格字段随组合更新。">
          <Table
            search
            columns={[...labels, '访问次数', '访客', '操作']}
            rows={rows.map((r, i) => [
              ...fields.map(f => r[f] || '未提供'),
              n(r.views),
              n(r.visitors),
              <ActionLink
                key={i}
                page="sessions"
                params={Object.fromEntries(
                  fields.map(f => [
                    `drill_${f}`,
                    r[f] == null || r[f] === '' ? 'empty.' : `eq.${r[f]}`,
                  ]),
                )}
              >
                访问
              </ActionLink>,
            ])}
            numeric={[fields.length, fields.length + 1]}
          />
        </Panel>
      </QueryState>
      <Notice>
        维度拆分使用多字段组合，保留缺失维度的“未提供”记录。事件名称沿用上游字段选择范围。
      </Notice>
      {open && (
        <Drawer title="选择拆分维度" onClose={() => setOpen(false)}>
          <Form
            submitLabel="应用维度"
            onSubmit={async (v, form) => {
              const next = Array.from(new FormData(form).getAll('dimension')).map(String);
              if (!next.length || next.length > 3) throw new Error('请选择 1 至 3 个维度');
              setFields(next);
              setOpen(false);
            }}
          >
            {options.map(([key, label]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  name="dimension"
                  value={key}
                  defaultChecked={fields.includes(key)}
                />
                <span>{label}</span>
              </label>
            ))}
          </Form>
        </Drawer>
      )}
    </>
  );
}
function Compare() {
  const c = useFeature(),
    scope = useScope();
  const size = c.range.endAt - c.range.startAt + 1;
  const [comparison, setComparison] = useState({
      startAt: c.range.startAt - size,
      endAt: c.range.startAt - 1,
    }),
    [open, setOpen] = useState(false);
  useEffect(
    () =>
      setComparison({ startAt: Math.max(0, c.range.startAt - size), endAt: c.range.startAt - 1 }),
    [c.range.startAt, c.range.endAt],
  );
  const query = useData(
    ['compare-rich', comparison],
    async signal => {
      const [current, previous, currentSeries, previousSeries, sources, oldSources] =
        await Promise.all([
          c.api.get(`/websites/${c.siteId}/stats`, scope, signal),
          c.api.get(`/websites/${c.siteId}/stats`, { ...scope, ...comparison }, signal),
          c.api.get(`/websites/${c.siteId}/pageviews`, { ...scope, unit: 'day' }, signal),
          c.api.get(
            `/websites/${c.siteId}/pageviews`,
            { ...scope, ...comparison, unit: 'day' },
            signal,
          ),
          c.api.get(
            `/liekan/websites/${c.siteId}/analytics`,
            { ...scope, kind: 'sources' },
            signal,
          ),
          c.api.get(
            `/liekan/websites/${c.siteId}/analytics`,
            { ...scope, ...comparison, kind: 'sources' },
            signal,
          ),
        ]);
      return { current, previous, currentSeries, previousSeries, sources, oldSources };
    },
    !!c.siteId && comparison.startAt >= 0,
  );
  const d = query.data;
  const change = (a: number, b: number) =>
    b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(2)}%` : a ? '新增' : '0%';
  const rate = (r: any) => (r?.visits ? (r.bounces / r.visits) * 100 : null);
  const channels = [
    ...new Set<string>([
      ...(d?.sources || []).map((r: any) => r.referrer || '直接访问'),
      ...(d?.oldSources || []).map((r: any) => r.referrer || '直接访问'),
    ]),
  ];
  const first = relativeDaySeries(
      d?.currentSeries?.sessions || [],
      c.range.startAt,
      c.range.endAt,
      c.range.timezone,
    ),
    second = relativeDaySeries(
      d?.previousSeries?.sessions || [],
      comparison.startAt,
      comparison.endAt,
      c.range.timezone,
    );
  const count = Math.max(first.length, second.length);
  return (
    <>
      <div className="notice row between">
        <span>
          <strong>当前：</strong>
          {date(c.range.startAt, c.range.timezone)} 至 {date(c.range.endAt, c.range.timezone)}　
          <strong>对照：</strong>
          {date(comparison.startAt, c.range.timezone)} 至 {date(comparison.endAt, c.range.timezone)}
        </span>
        <Button onClick={() => setOpen(true)}>调整对照期间</Button>
      </div>
      <QueryState readOnly query={query}>
        <Metrics
          loading={!!query.isPending}
          items={[
            [
              '访客',
              d ? n(d.current.visitors) : null,
              d ? `较对照期 ${change(d.current.visitors, d.previous.visitors)}` : '',
              'blue',
            ],
            [
              '页面访问',
              d ? n(d.current.pageviews) : null,
              d ? `较对照期 ${change(d.current.pageviews, d.previous.pageviews)}` : '',
            ],
            [
              '跳出率',
              rate(d?.current) == null ? '—' : `${rate(d?.current).toFixed(2)}%`,
              rate(d?.current) != null && rate(d?.previous) != null
                ? `较对照期 ${(rate(d.current) - rate(d.previous)).toFixed(2)} 个百分点`
                : '对照期无有效访问',
            ],
            [
              '平均访问时长',
              duration(d?.current?.visits ? d.current.totaltime / d.current.visits : null),
              '按同一访问口径计算',
            ],
          ]}
        />
        <Chart
          title="同期访问趋势"
          subtitle="对照序列按相对天数对齐，使用同一单位。"
          labels={Array.from({ length: count }, (_, i) => `第 ${i + 1} 天`)}
          series={[
            {
              name: '当前',
              values: Array.from({ length: count }, (_, i) => (i < first.length ? first[i] : null)),
            },
            {
              name: '对照',
              dashed: true,
              values: Array.from({ length: count }, (_, i) =>
                i < second.length ? second[i] : null,
              ),
            },
          ]}
        />
        <Panel title="来源变化" subtitle="各来源的绝对数量与变化比例。">
          <Table
            columns={['来源', '当前访客', '对照访客', '变化']}
            numeric={[1, 2, 3]}
            rows={channels.map(name => {
              const a = Number(
                  d.sources.find((r: any) => (r.referrer || '直接访问') === name)?.visitors || 0,
                ),
                b = Number(
                  d.oldSources.find((r: any) => (r.referrer || '直接访问') === name)?.visitors || 0,
                );
              return [name, n(a), n(b), change(a, b)];
            })}
          />
        </Panel>
      </QueryState>
      {open && (
        <Drawer title="对照日期" onClose={() => setOpen(false)}>
          <Form
            submitLabel="应用对照期间"
            onSubmit={async v => {
              const startAt = +fromZonedTime(`${v.start}T00:00:00`, c.range.timezone),
                endAt = +fromZonedTime(`${v.end}T23:59:59.999`, c.range.timezone);
              if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt)
                throw new Error('对照日期范围无效');
              if (endAt - startAt > 1096 * 86400000) throw new Error('对照日期范围上限 3 年');
              setComparison({ startAt, endAt });
              setOpen(false);
            }}
          >
            <div className="form-grid">
              <Field
                label="开始日期"
                type="date"
                name="start"
                required
                defaultValue={formatInTimeZone(comparison.startAt, c.range.timezone, 'yyyy-MM-dd')}
              />
              <Field
                label="结束日期"
                type="date"
                name="end"
                required
                defaultValue={formatInTimeZone(comparison.endAt, c.range.timezone, 'yyyy-MM-dd')}
              />
            </div>
          </Form>
        </Drawer>
      )}
    </>
  );
}
function Annotations() {
  const c = useFeature(),
    action = useAction();
  const scope = useScope();
  const [edit, setEdit] = useState<any>(null);
  const query = useData(
    ['annotation-list'],
    signal => getAllFeatureRows(`/websites/${c.siteId}/annotations`, scope, signal),
    !!c.siteId,
  );
  const chart = useWebsiteData(['annotations-chart'], 'pageviews', useScope({ unit: 'day' }));
  const values = relativeDaySeries(
    chart.data?.pageviews || [],
    c.range.startAt,
    c.range.endAt,
    c.range.timezone,
  );
  const firstDay = new Date(
    `${formatInTimeZone(c.range.startAt, c.range.timezone, 'yyyy-MM-dd')}T00:00:00Z`,
  );
  const points = values.map((y, i) => ({
    y,
    x: new Date(+firstDay + i * 86400000).toISOString().slice(0, 10),
  }));
  const dates = points.map(r => r.x);
  return (
    <>
      <Panel
        title="图表注释"
        subtitle="记录产品上线、内容发布与推广日期。"
        actions={
          canManage(c) && (
            <Button primary onClick={() => setEdit({})}>
              <Icon name="plus" />
              添加注释
            </Button>
          )
        }
      >
        <QueryState readOnly query={query}>
          <Table
            search
            columns={['日期', '注释', '操作']}
            rows={(query.data || []).map((r: any) => [
              formatInTimeZone(r.date, c.range.timezone, 'yyyy-MM-dd'),
              r.note,
              <Button key={r.id} disabled={!canManage(c)} onClick={() => setEdit(r)}>
                编辑注释
              </Button>,
            ])}
          />
        </QueryState>
      </Panel>
      <Panel title="访问趋势" subtitle="日期注释显示在相应时间节点。">
        <QueryState readOnly query={chart}>
          <Chart
            labels={dates}
            series={[{ name: '访问', values: points.map((r: any) => Number(r.y)) }]}
            option={{
              series: [
                {
                  type: 'line',
                  data: points.map((r: any) => Number(r.y)),
                  markLine: {
                    symbol: 'none',
                    label: { formatter: (p: any) => p.name },
                    data: (query.data || [])
                      .filter((r: any) =>
                        dates.includes(formatInTimeZone(r.date, c.range.timezone, 'yyyy-MM-dd')),
                      )
                      .map((r: any) => ({
                        xAxis: formatInTimeZone(r.date, c.range.timezone, 'yyyy-MM-dd'),
                        name: r.note,
                      })),
                  },
                },
              ],
            }}
          />
        </QueryState>
      </Panel>
      {edit && (
        <Drawer title={edit.id ? '编辑注释' : '添加注释'} onClose={() => setEdit(null)}>
          <Form
            busy={action.busy}
            error={action.error}
            submitLabel="保存注释"
            onSubmit={async v => {
              await action.run(
                () =>
                  c.api.post(`/websites/${c.siteId}/annotations${edit.id ? `/${edit.id}` : ''}`, {
                    date: fromZonedTime(`${v.date}T00:00:00`, c.range.timezone).toISOString(),
                    note: v.note,
                    allDay: true,
                  }),
                '注释已保存',
              );
              setEdit(null);
            }}
          >
            <Field
              label="日期"
              type="date"
              name="date"
              required
              defaultValue={formatInTimeZone(
                edit.date || Date.now(),
                c.range.timezone,
                'yyyy-MM-dd',
              )}
            />
            <Textarea
              label="注释"
              name="note"
              required
              maxLength={500}
              defaultValue={edit.note || ''}
            />
          </Form>
          {edit.id && (
            <Button
              danger
              disabled={action.busy}
              onClick={async () => {
                await action.run(
                  () => c.api.del(`/websites/${c.siteId}/annotations/${edit.id}`),
                  '已删除注释',
                );
                setEdit(null);
              }}
            >
              删除注释
            </Button>
          )}
        </Drawer>
      )}
    </>
  );
}
export function AnalyticsPages({ page }: { page: string }) {
  const c = useFeature();
  if (!analysisPages.has(page)) return null;
  if (!c.siteId)
    return (
      <Notice>
        请先添加网站或切换网站后查看分析。<LinkButton page="websites">网站管理</LinkButton>
      </Notice>
    );
  switch (page) {
    case 'realtime':
      return <Realtime />;
    case 'events':
      return <Events />;
    case 'event-detail':
      return <EventDetail />;
    case 'sessions':
      return <Sessions />;
    case 'session-detail':
      return <SessionDetail key={`${c.siteId}:${c.route.id}`} />;
    case 'filters':
      return <FilterEditor key={`${c.siteId}:${page}`} />;
    case 'segments':
      return <Audiences />;
    case 'cohorts':
      return <Audiences cohort />;
    case 'segment-editor':
      return <FilterEditor key={`${c.siteId}:${c.route.id}`} kind="segment-editor" />;
    case 'cohort-editor':
      return <FilterEditor key={`${c.siteId}:${c.route.id}`} kind="cohort-editor" />;
    case 'retention':
      return <Retention key={c.siteId} />;
    case 'journeys':
      return <Journeys />;
    case 'path-detail':
      return <Journeys detail key={c.query.sequence} />;
    case 'utm':
      return <UTM />;
    case 'attribution':
      return <Attribution />;
    case 'breakdown':
      return <Breakdown />;
    case 'compare':
      return <Compare />;
    case 'annotations':
      return <Annotations />;
    default:
      return null;
  }
}
