'use client';
import { TableCell } from './ui';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

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
  LiekanDialog,
  DialogActions,
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
  return {
    q,
    origin: q.data === undefined ? '' : origin,
    configured: kind === 'link' ? q.data?.linksUrl : q.data?.pixelsUrl,
  };
}
const format = (value: any, display = (source: string) => source) => {
  const metric = nativeMetric(value);
  return metric == null ? display('未提供') : numberLabel(metric);
};
function spaceLabel(
  teamId: string | undefined,
  teams: FeatureEntity[],
  display = (source: string) => source,
) {
  return teamId
    ? teams.find(team => team.id === teamId)?.name || display('团队空间（名称未提供）')
    : display('个人空间');
}
function ResourceList({ kind }: { kind: 'link' | 'pixel' }) {
  const i18n = useLiekanI18n();
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
    ids.length > 0 && q.isSuccess && !q.isPlaceholderData,
  );
  const team = c.teams.find(team => team.id === c.route.teamId),
    canCreate = canCreateResource(c.user, team);
  return (
    <>
      <Panel
        title={i18n.system(kind === 'link' ? i18n.text('链接追踪') : i18n.text('图片追踪'))}
        subtitle={i18n.text('所属空间：{v0}。{v1}', [
          spaceLabel(c.route.teamId, c.teams, i18n.system),
          kind === 'link'
            ? i18n.text('查看短链的点击次数与访客。')
            : i18n.text('查看图片请求次数，独立于网站访问统计。'),
        ])}
        actions={
          <>
            <label className="search">
              <input
                type="search"
                aria-label={i18n.text('搜索{v0}', [
                  kind === 'link' ? i18n.text('链接') : i18n.text('追踪图片'),
                ])}
                placeholder={i18n.text('搜索名称或标识')}
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
                {i18n.fragment('创建', true, true)}
                {kind === 'link' ? i18n.text('链接追踪') : i18n.text('图片追踪')}
              </LinkButton>
            )}
          </>
        }
      >
        <QueryState query={q}>
          {stats.error && (
            <Notice tone="red">
              {i18n.fragment('统计读取失败：', false, true)}
              {i18n.system(stats.error.message)}
              <Button onClick={() => stats.refetch()}>{i18n.text('重试统计')}</Button>
            </Notice>
          )}
          <Table
            mobile
            rowKeys={rows.map(row => row.id)}
            columns={
              kind === 'link'
                ? ['名称', '目标地址', '短链标识', '点击次数', '操作']
                : ['名称', '图片标识', '请求次数', '操作']
            }
            rows={rows.map(row => [
              row.name,
              ...(kind === 'link' ? [row.url] : []),
              <code key="cell-code-1">{row.slug}</code>,
              <TableCell
                sortValue={
                  stats.isPending && ids.length
                    ? i18n.source('读取中')
                    : stats.error
                      ? i18n.source('读取失败')
                      : format(stats.data?.data?.[row.id]?.total, canonicalText => canonicalText)
                }
                searchValue={
                  stats.isPending && ids.length
                    ? i18n.english.text('读取中')
                    : stats.error
                      ? i18n.english.text('读取失败')
                      : format(stats.data?.data?.[row.id]?.total, i18n.english.system)
                }
              >
                {stats.isPending && ids.length
                  ? i18n.text('读取中')
                  : stats.error
                    ? i18n.text('读取失败')
                    : format(stats.data?.data?.[row.id]?.total, i18n.system)}
              </TableCell>,
              <TableCell
                sortValue={kind === 'link' ? i18n.source('查看链接') : i18n.source('查看图片')}
                searchValue={
                  kind === 'link' ? i18n.english.text('查看链接') : i18n.english.text('查看图片')
                }
              >
                <LinkButton key="cell-linkbutton-2" page={`${kind}-detail`} params={{ id: row.id }}>
                  {kind === 'link' ? i18n.text('查看链接') : i18n.text('查看图片')}
                </LinkButton>
              </TableCell>,
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
          ? i18n.text('点击次数按所选日期范围统计。短链地址会将访客重定向到目标 URL。')
          : i18n.text(
              '邮件代理、缓存和重复请求会影响图片请求量。请求次数不能直接视为真实阅读人数。',
            )}
      </Notice>
    </>
  );
}
function QRCode({ url }: { url: string }) {
  const i18n = useLiekanI18n();
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
    <img src={image} width={200} height={200} alt={i18n.text('链接二维码')} />
  ) : error ? (
    <Notice tone="red">{i18n.system(error)}</Notice>
  ) : (
    <p className="muted">{i18n.text('正在生成二维码')}</p>
  );
}
function ResourceEditor({ kind, record }: { kind: 'link' | 'pixel'; record?: FeatureEntity }) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction(),
    host = useResourceHost(kind),
    [slug, setSlug] = useState(record?.slug || randomSlug),
    [remove, setRemove] = useState(false);
  const path = kind === 'link' ? 'links' : 'pixels',
    url = resourceUrl(host.origin, basePath, kind, slug, host.configured),
    code = `<img src="${url}" width="1" height="1" alt="" />`;
  const canEdit = record ? canManageResource(c.user, record, c.teams) : canCreateResource(c.user);
  return (
    <>
      <Panel
        title={i18n.system(kind === 'link' ? i18n.text('链接信息') : i18n.text('图片信息'))}
        subtitle={i18n.system(
          kind === 'link'
            ? i18n.text('名称、目标地址与自定义短链标识。')
            : i18n.text('名称和自动生成的图片地址。'),
        )}
      >
        <Body>
          {!canEdit && (
            <Notice tone="amber">
              {i18n.text('当前角色可以查看资源。保存操作需要管理权限。')}
            </Notice>
          )}
          <QueryState query={host.q}>
            <Form
              busy={action.busy}
              disabled={!canEdit}
              submitLabel={i18n.system(
                kind === 'link' ? i18n.text('保存链接') : i18n.text('保存图片'),
              )}
              cancel={<LinkButton page={path}>{i18n.text('取消')}</LinkButton>}
              onSubmit={async (values: any) => {
                const owner = !record ? String(values.owner || '') : '';
                const team = owner ? c.teams.find(team => team.id === owner) : undefined;
                if (!record && ((owner && !team) || !canCreateResource(c.user, team)))
                  throw new Error('请选择有创建权限的所属空间');
                const body = linkPayload({ ...values, slug }, kind, !record ? owner : undefined);
                const result = await action.run(
                  () => c.api.post(record ? `/${path}/${record.id}` : `/${path}`, body),
                  kind === 'link' ? '链接已保存' : '图片已保存',
                );
                c.navigate(`${kind}-detail`, {
                  id: result.id,
                  ...(!record ? { teamId: result.teamId || owner } : {}),
                });
              }}
            >
              {record ? (
                <Field
                  label={i18n.text('所属空间')}
                  value={spaceLabel(record.teamId, c.teams, i18n.system)}
                  readOnly
                  help={i18n.text('编辑时保留资源的原有归属。')}
                />
              ) : (
                <Select
                  label={i18n.text('所属空间')}
                  name="owner"
                  defaultValue={c.route.teamId || ''}
                  options={[
                    ['', i18n.text('个人空间')],
                    ...c.teams
                      .filter(team => canCreateResource(c.user, team))
                      .map(team => [team.id, team.name] as [string, string]),
                  ]}
                  help={i18n.text('选择此资源所属的个人空间或有创建权限的团队。')}
                />
              )}
              <Field
                label={kind === 'link' ? i18n.text('链接名称') : i18n.text('图片名称')}
                name="name"
                defaultValue={record?.name || ''}
                required
                maxLength={100}
              />
              {kind === 'link' && (
                <>
                  <Field
                    label={i18n.text('目标 URL')}
                    name="url"
                    type="url"
                    defaultValue={record?.url || ''}
                    required
                    maxLength={500}
                    placeholder="https://"
                    help={i18n.text('需要完整 https:// 或 http:// 地址。')}
                  />
                  {!host.q.data?.cloudMode && (
                    <div className="row">
                      <Field
                        label={i18n.text('短链标识')}
                        name="slug"
                        required
                        value={slug}
                        onChange={e => setSlug(e.target.value)}
                        minLength={8}
                        maxLength={100}
                        pattern="[a-zA-Z0-9_-]{8,100}"
                        help={i18n.text('8 至 100 位字母、数字、短横线与下划线。')}
                      />
                      <Button disabled={action.busy} onClick={() => setSlug(randomSlug())}>
                        {i18n.text('随机生成')}
                      </Button>
                    </div>
                  )}
                </>
              )}
              <Field
                label={kind === 'link' ? i18n.text('预览地址') : i18n.text('图片地址')}
                value={url}
                readOnly
                help={i18n.system(
                  record ? i18n.text('已保存资源的真实地址。') : i18n.text('保存后此地址生效。'),
                )}
              />
              {kind === 'pixel' && (
                <>
                  <Code>{code}</Code>
                  <Button
                    disabled={!url || action.busy}
                    onClick={async () => {
                      await navigator.clipboard.writeText(code);
                      c.notify('图片代码已复制');
                    }}
                  >
                    <Icon name="copy" />
                    {i18n.fragment('复制图片代码', true, false)}
                  </Button>
                  <Button disabled={action.busy} onClick={() => setSlug(randomSlug())}>
                    {i18n.text('重新生成地址')}
                  </Button>
                </>
              )}
              {record && (
                <>
                  <hr className="divider" />
                  <Button danger disabled={action.busy || !canEdit} onClick={() => setRemove(true)}>
                    {i18n.fragment('删除', false, true)}
                    {kind === 'link' ? i18n.text('链接') : i18n.text('追踪图片')}
                  </Button>
                </>
              )}
            </Form>
          </QueryState>
        </Body>
      </Panel>
      {remove && (
        <LiekanDialog
          title={i18n.text('删除{v0}', [
            kind === 'link' ? i18n.text('链接') : i18n.text('追踪图片'),
          ])}
          onClose={() => !action.busy && setRemove(false)}
        >
          <Form
            busy={action.busy}
            danger
            submitLabel={i18n.system(
              kind === 'link' ? i18n.text('删除链接') : i18n.text('删除追踪图片'),
            )}
            onSubmit={async (values: any) => {
              if (values.confirmation !== record.name)
                throw new Error(`请输入${kind === 'link' ? '链接' : '追踪图片'}名称确认删除`);
              await action.run(
                () => c.api.del(`/${path}/${record.id}`),
                kind === 'link' ? '链接已删除' : '图片已删除',
                { navigateTo: path },
              );
              setRemove(false);
            }}
          >
            <Notice tone="red">
              {i18n.fragment('将删除', false, true)}
              {kind === 'link' ? i18n.text('链接') : i18n.text('追踪图片')}“{record.name}
              {i18n.fragment('”及其统计数据。', true, true)}
              {kind === 'link' ? i18n.text('短链地址') : i18n.text('图片地址')}
              {i18n.fragment('和分享链接将失效。', true, false)}
            </Notice>
            <Field
              label={i18n.text('输入 {v0} 确认', [record.name])}
              name="confirmation"
              required
              autoComplete="off"
            />
          </Form>
        </LiekanDialog>
      )}
    </>
  );
}
function ResourceDetail({ kind, record }: { kind: 'link' | 'pixel'; record: FeatureEntity }) {
  const i18n = useLiekanI18n();
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
          {kind === 'link' ? (
            <QueryState readOnly query={host.q}>
              <p className="muted">{host.q.isPending ? i18n.text('正在读取链接地址') : url}</p>
            </QueryState>
          ) : (
            <p className="muted">
              {i18n.fragment('图片标识 · ', false, true)}
              {record.slug}
            </p>
          )}
        </div>
        <div className="actions">
          <LinkButton page={`${kind}-editor`} params={{ id }}>
            {i18n.fragment('编辑', false, true)}
            {kind === 'link' ? i18n.text('链接') : i18n.text('追踪图片')}
          </LinkButton>
          <Button disabled={!allowed} onClick={() => setShare(true)}>
            {i18n.fragment('分享当前', false, true)}
            {kind === 'link' ? i18n.text('链接') : i18n.text('追踪图片')}
          </Button>
          {kind === 'link' && (
            <Button disabled={!url} onClick={() => setQr(true)}>
              {i18n.text('查看链接二维码')}
            </Button>
          )}
          <LinkButton page={path}>
            {i18n.fragment('返回', false, true)}
            {kind === 'link' ? i18n.text('链接') : i18n.text('追踪图片')}
            {i18n.fragment('列表', true, false)}
          </LinkButton>
        </div>
      </div>
      <QueryState query={stats}>
        <Metrics
          loading={stats.isPending}
          items={
            kind === 'link'
              ? [
                  [
                    i18n.text('点击次数'),
                    format(stats.data?.stats?.pageviews, i18n.system),
                    i18n.text('当前期间'),
                  ],
                  [
                    i18n.text('独立访客'),
                    format(stats.data?.stats?.visitors, i18n.system),
                    i18n.text('访问标识聚合'),
                  ],
                  [
                    i18n.text('主要来源'),
                    stats.data?.sources == null
                      ? i18n.text('未提供')
                      : rowsOf<any>(stats.data.sources).length
                        ? rowsOf<any>(stats.data.sources)[0]?.x || i18n.text('直接访问')
                        : i18n.text('尚无访问'),
                    i18n.text('按独立访客排名'),
                  ],
                  [i18n.text('目标网站'), domain, record.url],
                ]
              : [
                  [
                    i18n.text('请求次数'),
                    format(stats.data?.stats?.pageviews, i18n.system),
                    i18n.text('按图片请求计数'),
                  ],
                  [i18n.text('统计口径'), i18n.text('图片请求'), i18n.text('包括代理与缓存影响')],
                  [
                    i18n.text('主要环境'),
                    rowsOf<any>(stats.data?.environment)[0]?.x || i18n.text('未提供'),
                    i18n.text('按独立访问标识排名'),
                  ],
                  [
                    i18n.text('最近请求'),
                    stats.data?.dates == null
                      ? i18n.text('未提供')
                      : stats.data.dates.endDate
                        ? new Date(stats.data.dates.endDate).toLocaleString(i18n.locale, {
                            timeZone: getFeaturePreferences().timezone,
                          })
                        : i18n.text('尚未接收'),
                    i18n.text('全量历史的最近请求'),
                  ],
                ]
          }
        />
      </QueryState>
      <ResourceAnalytics
        id={id}
        kind={kind}
        metrics={false}
        title={i18n.system(kind === 'link' ? i18n.text('链接访问趋势') : i18n.text('图片请求趋势'))}
      />
      {kind === 'link' ? (
        <Panel
          title={i18n.text('来源与地域')}
          subtitle={i18n.text('按真实来源与地域联合统计链接点击次数。')}
        >
          <QueryState query={jointSources}>
            <Table
              columns={['来源', '地域', '点击次数']}
              rows={(jointSources.data?.rows || []).map((row: any) => [
                <TableCell
                  sortValue={row.source || i18n.source('直接访问')}
                  searchValue={row.source || i18n.english.text('直接访问')}
                >
                  {row.source || i18n.text('直接访问')}
                </TableCell>,
                <TableCell
                  sortValue={row.country || i18n.source('未知')}
                  searchValue={row.country || i18n.english.text('未知')}
                >
                  {row.country || i18n.text('未知')}
                </TableCell>,
                <TableCell
                  sortValue={format(row.clicks, canonicalText => canonicalText)}
                  searchValue={format(row.clicks, i18n.english.system)}
                >
                  {format(row.clicks, i18n.system)}
                </TableCell>,
              ])}
              numeric={[2]}
              page={sourcePage}
              pages={Math.max(1, Math.ceil((jointSources.data?.count || 0) / 25))}
              onPage={setSourcePage}
            />
          </QueryState>
        </Panel>
      ) : (
        <Panel title={i18n.text('安装代码')} subtitle={i18n.text('图片引用沿用现有图片地址格式。')}>
          <Body>
            <QueryState readOnly query={host.q}>
              <Code>{host.q.isPending ? i18n.text('正在读取图片地址') : code}</Code>
              <Button
                disabled={!url}
                onClick={async () => {
                  await navigator.clipboard.writeText(code);
                  c.notify('图片代码已复制');
                }}
              >
                <Icon name="copy" />
                {i18n.fragment('复制图片代码', true, false)}
              </Button>
              <Button
                disabled={!url}
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  c.notify('图片地址已复制');
                }}
              >
                {i18n.text('复制图片地址')}
              </Button>
            </QueryState>
          </Body>
        </Panel>
      )}
      {share && <ShareDrawer entity={{ ...record, kind }} onClose={() => setShare(false)} />}
      {qr && (
        <LiekanDialog title={i18n.text('链接二维码')} onClose={() => setQr(false)}>
          <div className="qr-dialog-layout">
            <QRCode url={url} />
            <div className="stack">
              <h3>{record.name}</h3>
              <p className="muted">{i18n.text('扫描二维码打开链接。可复制下方地址分享。')}</p>
              <Code>{url}</Code>
            </div>
          </div>
          <DialogActions>
            <Button
              primary
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                c.notify('链接已复制');
              }}
            >
              {i18n.text('复制链接')}
            </Button>
          </DialogActions>
        </LiekanDialog>
      )}
    </>
  );
}
function ResourcePage({ page, kind }: { page: string; kind: 'link' | 'pixel' }) {
  const i18n = useLiekanI18n();
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
        {i18n.fragment('请选择一个', false, true)}
        {kind === 'link' ? i18n.text('链接') : i18n.text('追踪图片')}。
        <LinkButton page={path}>{i18n.text('返回列表')}</LinkButton>
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
