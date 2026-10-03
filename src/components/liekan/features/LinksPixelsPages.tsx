'use client';
import { useListState } from './listState';

import { useEffect, useState } from 'react';
import type { FeatureEntity } from '@/lib/liekan/contracts/features';
import { numberLabel, rowsOf } from '@/lib/liekan/contracts/features';
import {
  canCreateResource,
  canManageResource,
  linkPayload,
  nativeMetric,
  resourceUrl,
} from '@/lib/liekan/contracts/workspace';
import { getFeaturePreferences } from '@/lib/liekan/upstream/features-client';
import { useAction, useData, useFeature, useResourceContext } from './context';
import {
  Body,
  Button,
  Code,
  Drawer,
  Field,
  Form,
  Icon,
  LinkButton,
  Metrics,
  Notice,
  Panel,
  QueryState,
  Table,
} from './ui';
import { ResourceAnalytics, ShareDrawer } from './WorkspacePages';

export const linksPixelsPages = new Set([
  'links',
  'link-editor',
  'link-detail',
  'pixels',
  'pixel-editor',
  'pixel-detail',
]);
const basePath = process.env.basePath || '';
const randomSlug = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
function useResourceHost(kind: 'link' | 'pixel') {
  const c = useFeature(),
    [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const q = useData('resource-config', signal => c.api.get('/config', undefined, signal));
  return { q, origin, configured: kind === 'link' ? q.data?.linksUrl : q.data?.pixelsUrl };
}
const format = (value: any) => {
  const metric = nativeMetric(value);
  return metric == null ? '未提供' : numberLabel(metric);
};
function spaceLabel(teamId: string | undefined, teams: FeatureEntity[]) {
  return teamId
    ? teams.find(team => team.id === teamId)?.name || '团队空间（名称未提供）'
    : '个人空间';
}
function ResourceList({ kind }: { kind: 'link' | 'pixel' }) {
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    path = kind === 'link' ? 'links' : 'pixels';
  const q = useData([path, c.route.teamId, page, search], signal =>
    c.api.get(
      c.route.teamId ? `/teams/${c.route.teamId}/${path}` : `/${path}`,
      { page, pageSize: 20, search },
      signal,
    ),
  );
  const rows = rowsOf<FeatureEntity>(q.data),
    ids = rows.map(row => row.id);
  const stats = useData(
    [`${path}-list-stats`, ids],
    signal => c.api.get(`/${path}/charts`, { ids: ids.join(','), ...c.range }, signal),
    ids.length > 0,
  );
  const team = c.teams.find(team => team.id === c.route.teamId),
    canCreate = canCreateResource(c.user, team);
  return (
    <>
      <Panel
        title={kind === 'link' ? '追踪链接' : '追踪像素'}
        subtitle={`所属空间：${spaceLabel(c.route.teamId, c.teams)}。${
          kind === 'link' ? '查看短链的点击次数与访客。' : '查看图片请求次数，独立于网站访问统计。'
        }`}
        actions={
          <>
            <label className="search">
              <input
                type="search"
                aria-label={`搜索${kind === 'link' ? '链接' : '像素'}`}
                placeholder="搜索名称或标识"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            {canCreate && (
              <LinkButton page={`${kind}-editor`} primary>
                <Icon name="plus" />
                创建{kind === 'link' ? '链接' : '像素'}
              </LinkButton>
            )}
          </>
        }
      >
        <QueryState query={q}>
          {stats.error && (
            <Notice tone="red">
              统计读取失败：{stats.error.message}
              <Button onClick={() => stats.refetch()}>重试统计</Button>
            </Notice>
          )}
          <Table
            columns={
              kind === 'link'
                ? ['名称', '目标地址', '短链标识', '点击次数', '操作']
                : ['名称', '像素标识', '请求次数', '操作']
            }
            rows={rows.map(row => [
              row.name,
              ...(kind === 'link' ? [row.url] : []),
              <code key="cell-code-1">{row.slug}</code>,
              stats.isPending && ids.length
                ? '读取中'
                : stats.error
                  ? '读取失败'
                  : format(stats.data?.data?.[row.id]?.total),
              <LinkButton key="cell-linkbutton-2" page={`${kind}-detail`} params={{ id: row.id }}>
                {kind === 'link' ? '查看链接' : '查看像素'}
              </LinkButton>,
            ])}
            numeric={[kind === 'link' ? 3 : 2]}
            page={page}
            pages={Math.max(1, Math.ceil((q.data?.count || 0) / (q.data?.pageSize || 20)))}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      <Notice>
        {kind === 'link'
          ? '点击次数按所选日期范围统计。短链地址会将访客重定向到目标 URL。'
          : '邮件代理、缓存和重复请求会影响像素请求量。请求次数不能直接视为真实阅读人数。'}
      </Notice>
    </>
  );
}
function QRCode({ url }: { url: string }) {
  const [image, setImage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let canceled = false;
    setImage('');
    setError('');
    if (url)
      void import('qrcode')
        .then(module => module.toDataURL(url, { width: 200, margin: 1 }))
        .then(value => {
          if (!canceled) setImage(value);
        })
        .catch(() => {
          if (!canceled) setError('二维码生成失败');
        });
    return () => {
      canceled = true;
    };
  }, [url]);
  return image ? (
    <img src={image} width={200} height={200} alt="链接二维码" />
  ) : error ? (
    <Notice tone="red">{error}</Notice>
  ) : (
    <p className="muted">正在生成二维码</p>
  );
}
function ResourceEditor({ kind, record }: { kind: 'link' | 'pixel'; record?: FeatureEntity }) {
  const c = useFeature(),
    action = useAction(),
    host = useResourceHost(kind),
    [slug, setSlug] = useState(record?.slug || randomSlug),
    [remove, setRemove] = useState(false);
  const path = kind === 'link' ? 'links' : 'pixels',
    url = resourceUrl(host.origin, basePath, kind, slug, host.configured),
    code = `<img src="${url}" width="1" height="1" alt="" />`;
  const canEdit = record
    ? canManageResource(c.user, record, c.teams)
    : canCreateResource(
        c.user,
        c.teams.find(team => team.id === c.route.teamId),
      );
  return (
    <>
      <Panel
        title={kind === 'link' ? '链接信息' : '像素信息'}
        subtitle={
          kind === 'link' ? '名称、目标地址与自定义短链标识。' : '名称和自动生成的像素地址。'
        }
      >
        <Body>
          {!canEdit && <Notice tone="amber">当前角色可以查看资源。保存操作需要管理权限。</Notice>}
          <QueryState query={host.q}>
            <Form
              busy={action.busy}
              disabled={!canEdit}
              submitLabel={kind === 'link' ? '保存链接' : '保存像素'}
              cancel={<LinkButton page={path}>取消</LinkButton>}
              onSubmit={async (values: any) => {
                const body = linkPayload(
                  { ...values, slug },
                  kind,
                  !record ? c.route.teamId : undefined,
                );
                const result = await action.run(
                  () => c.api.post(record ? `/${path}/${record.id}` : `/${path}`, body),
                  kind === 'link' ? '链接已保存' : '像素已保存',
                );
                c.navigate(`${kind}-detail`, { id: result.id });
              }}
            >
              <Field
                label="所属空间"
                value={spaceLabel(record ? record.teamId : c.route.teamId, c.teams)}
                readOnly
                help="链接与像素按所属空间管理，编辑时保留原有归属。"
              />
              <Field
                label={kind === 'link' ? '链接名称' : '像素名称'}
                name="name"
                defaultValue={record?.name || ''}
                required
                maxLength={100}
              />
              {kind === 'link' && (
                <>
                  <Field
                    label="目标 URL"
                    name="url"
                    type="url"
                    defaultValue={record?.url || ''}
                    required
                    maxLength={500}
                    placeholder="https://"
                    help="需要完整 https:// 或 http:// 地址。"
                  />
                  {!host.q.data?.cloudMode && (
                    <div className="row">
                      <Field
                        label="短链标识"
                        name="slug"
                        required
                        value={slug}
                        onChange={e => setSlug(e.target.value)}
                        minLength={8}
                        maxLength={100}
                        pattern="[a-zA-Z0-9_-]{8,100}"
                        help="8 至 100 位字母、数字、短横线与下划线。"
                      />
                      <Button disabled={action.busy} onClick={() => setSlug(randomSlug())}>
                        随机生成
                      </Button>
                    </div>
                  )}
                </>
              )}
              <Field
                label={kind === 'link' ? '预览地址' : '像素地址'}
                value={url}
                readOnly
                help={record ? '已保存资源的真实地址。' : '保存后此地址生效。'}
              />
              {kind === 'pixel' && (
                <>
                  <Code>{code}</Code>
                  <Button
                    disabled={!url || action.busy}
                    onClick={async () => {
                      await navigator.clipboard.writeText(code);
                      c.notify('像素代码已复制');
                    }}
                  >
                    <Icon name="copy" />
                    复制像素代码
                  </Button>
                  <Button disabled={action.busy} onClick={() => setSlug(randomSlug())}>
                    重新生成地址
                  </Button>
                </>
              )}
              {record && (
                <>
                  <hr className="divider" />
                  <Button danger disabled={action.busy || !canEdit} onClick={() => setRemove(true)}>
                    删除{kind === 'link' ? '链接' : '像素'}
                  </Button>
                </>
              )}
            </Form>
          </QueryState>
        </Body>
      </Panel>
      {remove && (
        <Drawer
          title={`删除${kind === 'link' ? '链接' : '像素'}`}
          onClose={() => !action.busy && setRemove(false)}
        >
          <Form
            busy={action.busy}
            submitLabel={kind === 'link' ? '删除链接' : '删除像素'}
            onSubmit={async (values: any) => {
              if (values.confirmation !== record.name)
                throw new Error(`请输入${kind === 'link' ? '链接' : '像素'}名称确认删除`);
              await action.run(
                () => c.api.del(`/${path}/${record.id}`),
                kind === 'link' ? '链接已删除' : '像素已删除',
              );
              c.navigate(path);
            }}
          >
            <Notice tone="red">
              将删除{kind === 'link' ? '链接' : '像素'}“{record.name}”及其统计数据。
              {kind === 'link' ? '短链地址' : '像素地址'}和分享链接将失效。
            </Notice>
            <Field
              label={`输入 ${record.name} 确认`}
              name="confirmation"
              required
              autoComplete="off"
            />
          </Form>
        </Drawer>
      )}
    </>
  );
}
function ResourceDetail({ kind, record }: { kind: 'link' | 'pixel'; record: FeatureEntity }) {
  const c = useFeature(),
    host = useResourceHost(kind),
    [share, setShare] = useState(false),
    [qr, setQr] = useState(false),
    [sourcePage, setSourcePage] = useState(1);
  const id = record.id,
    path = kind === 'link' ? 'links' : 'pixels',
    url = resourceUrl(host.origin, basePath, kind, record.slug, host.configured),
    params = { ...c.range, eventType: kind === 'link' ? 3 : 4 };
  const stats = useData(['resource-detail-stats', kind, id], async signal => {
    const [stats, sources, countries, environment, dates] = await Promise.all([
      c.api.get(`/websites/${id}/stats`, params, signal),
      c.api.get(`/websites/${id}/metrics`, { ...params, type: 'referrer', limit: 20 }, signal),
      c.api.get(`/websites/${id}/metrics`, { ...params, type: 'country', limit: 20 }, signal),
      kind === 'pixel'
        ? c.api.get(`/websites/${id}/metrics`, { ...params, type: 'browser', limit: 20 }, signal)
        : null,
      kind === 'pixel' ? c.api.get(`/websites/${id}/daterange`, undefined, signal) : null,
    ]);
    return { stats, sources, countries, environment, dates };
  });
  const jointSources = useData(['link-joint-sources', id, sourcePage], signal =>
    kind === 'link'
      ? c.api.get(`/liekan/links/${id}/sources`, { ...c.range, page: sourcePage }, signal)
      : Promise.resolve(null),
  );
  useEffect(() => setSourcePage(1), [id, JSON.stringify(c.range), JSON.stringify(c.filters)]);
  const code = `<img src="${url}" width="1" height="1" alt="" />`,
    allowed = canManageResource(c.user, record, c.teams);
  let domain = '未提供';
  try {
    domain = new URL(record.url).hostname;
  } catch {}
  return (
    <>
      <div className="row between">
        <div>
          <h2>{record.name}</h2>
          <p className="muted">{kind === 'link' ? url : `像素标识 · ${record.slug}`}</p>
        </div>
        <div className="actions">
          <LinkButton page={`${kind}-editor`} params={{ id }}>
            编辑{kind === 'link' ? '链接' : '像素'}
          </LinkButton>
          <Button disabled={!allowed} onClick={() => setShare(true)}>
            分享当前{kind === 'link' ? '链接' : '像素'}
          </Button>
          {kind === 'link' && (
            <Button disabled={!url} onClick={() => setQr(true)}>
              查看链接二维码
            </Button>
          )}
          <LinkButton page={path}>返回{kind === 'link' ? '链接' : '像素'}列表</LinkButton>
        </div>
      </div>
      <QueryState query={stats}>
        <Metrics
          items={
            kind === 'link'
              ? [
                  ['点击次数', format(stats.data?.stats?.pageviews), '当前期间'],
                  ['独立访客', format(stats.data?.stats?.visitors), '访问标识聚合'],
                  [
                    '主要来源',
                    stats.data?.sources == null
                      ? '未提供'
                      : rowsOf<any>(stats.data.sources).length
                        ? rowsOf<any>(stats.data.sources)[0]?.x || '直接访问'
                        : '尚无访问',
                    '按独立访客排名',
                  ],
                  ['目标网站', domain, record.url],
                ]
              : [
                  ['请求次数', format(stats.data?.stats?.pageviews), '按像素请求计数'],
                  ['统计口径', '图片请求', '包括代理与缓存影响'],
                  [
                    '主要环境',
                    rowsOf<any>(stats.data?.environment)[0]?.x || '未提供',
                    '按独立访问标识排名',
                  ],
                  [
                    '最近请求',
                    stats.data?.dates == null
                      ? '未提供'
                      : stats.data.dates.endDate
                        ? new Date(stats.data.dates.endDate).toLocaleString('zh-CN', {
                            timeZone: getFeaturePreferences().timezone,
                          })
                        : '尚未接收',
                    '全量历史的最近请求',
                  ],
                ]
          }
        />
      </QueryState>
      <ResourceAnalytics
        id={id}
        kind={kind}
        metrics={false}
        title={kind === 'link' ? '链接访问趋势' : '像素请求趋势'}
      />
      {kind === 'link' ? (
        <Panel title="来源与地域" subtitle="按真实来源与地域联合统计链接点击次数。">
          <QueryState query={jointSources}>
            <Table
              columns={['来源', '地域', '点击次数']}
              rows={(jointSources.data?.rows || []).map((row: any) => [
                row.source || '直接访问',
                row.country || '未知',
                format(row.clicks),
              ])}
              numeric={[2]}
              page={sourcePage}
              pages={Math.max(1, Math.ceil((jointSources.data?.count || 0) / 25))}
              onPage={setSourcePage}
            />
          </QueryState>
        </Panel>
      ) : (
        <Panel title="安装代码" subtitle="图片引用沿用现有像素地址格式。">
          <Body>
            <QueryState query={host.q}>
              <Code>{code}</Code>
              <Button
                disabled={!url}
                onClick={async () => {
                  await navigator.clipboard.writeText(code);
                  c.notify('像素代码已复制');
                }}
              >
                <Icon name="copy" />
                复制像素代码
              </Button>
              <Button
                disabled={!url}
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  c.notify('像素地址已复制');
                }}
              >
                复制像素地址
              </Button>
            </QueryState>
          </Body>
        </Panel>
      )}
      {share && <ShareDrawer entity={{ ...record, kind }} onClose={() => setShare(false)} />}
      {qr && (
        <Drawer title="链接二维码" onClose={() => setQr(false)}>
          <QRCode url={url} />
          <Code>{url}</Code>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              c.notify('链接已复制');
            }}
          >
            复制链接
          </Button>
        </Drawer>
      )}
    </>
  );
}
function ResourcePage({ page, kind }: { page: string; kind: 'link' | 'pixel' }) {
  const c = useFeature(),
    id = c.route.id,
    path = kind === 'link' ? 'links' : 'pixels',
    q = useData(
      ['resource-record', kind, id],
      signal => c.api.get<FeatureEntity>(`/${path}/${id}`, undefined, signal),
      !!id,
    );
  useResourceContext(q.data);
  if (!id)
    return page.endsWith('editor') ? (
      <ResourceEditor kind={kind} />
    ) : (
      <Notice>
        请选择一个{kind === 'link' ? '链接' : '像素'}。<LinkButton page={path}>返回列表</LinkButton>
      </Notice>
    );
  return (
    <QueryState query={q}>
      {q.data &&
        (page.endsWith('editor') ? (
          <ResourceEditor key={id} kind={kind} record={q.data} />
        ) : (
          <ResourceDetail kind={kind} record={q.data} />
        ))}
    </QueryState>
  );
}
export function LinksPixelsPages({ page }: { page: string }) {
  const kind = page.startsWith('link') ? 'link' : 'pixel';
  return page === 'links' || page === 'pixels' ? (
    <ResourceList kind={kind} />
  ) : (
    <ResourcePage page={page} kind={kind} />
  );
}
