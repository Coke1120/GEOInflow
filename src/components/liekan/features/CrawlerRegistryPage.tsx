'use client';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import type {
  CatalogPayload,
  CrawlerRegistryCommand,
  CrawlerRegistryCommandResponse,
  CrawlerRegistryResponse,
  PublishedCatalog,
  RegistryDraft,
} from '@/lib/liekan/contracts/crawler-registry';
import { catalogPayloadSchema } from '@/lib/liekan/contracts/crawler-registry';
import type { CrawlerSourcesResponse } from '@/lib/liekan/contracts/crawler-maintenance';
import { useData, useFeature } from './context';
import {
  Badge,
  Body,
  Button,
  Check,
  Definition,
  DialogActions,
  Field,
  LiekanDialog,
  Metrics,
  Notice,
  Panel,
  Select,
  Table,
  Tabs,
  Textarea,
} from './ui';
import { ManagementDrawer } from '../ManagementDrawer';
import { CrawlerSourcesPanel } from './CrawlerSourcesPanel';
import { CrawlerRegistryRecord } from './CrawlerRegistryRecord';
import {
  type CatalogSection,
  formLabels,
  matchesBusinessFilter,
  purposeLabels,
  registryCounts,
  removeCatalogRecord,
  sectionLabels,
  statusLabels,
} from './crawlerRegistryUi';

const endpoint = '/liekan/admin/crawler-registry';
export function CrawlerRegistryPage() {
  const c = useFeature(),
    i18n = useLiekanI18n();
  const admin = !!c.user.isAdmin;
  const [data, setData] = useState<CrawlerRegistryResponse>();
  const [tab, setTab] = useState(
    ['library', 'platforms', 'sources', 'changes'].includes(c.query.tab) ? c.query.tab : 'library',
  );
  const [draftId, setDraftId] = useState('');
  const [business, setBusiness] = useState('all');
  const [region, setRegion] = useState('all');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{
    section: CatalogSection;
    record?: any;
    draftRevision?: string;
  }>();
  const [siteId, setSiteId] = useState(c.query.site || '');
  const [siteOpen, setSiteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [retry, setRetry] = useState<CrawlerRegistryCommand>();
  const [positive, setPositive] = useState('');
  const [negative, setNegative] = useState('');
  const [sampleDirty, setSampleDirty] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const query = useData<CrawlerRegistryResponse>(['crawler-registry', admin], async signal =>
    admin
      ? c.api.get(endpoint, undefined, signal)
      : {
          current: await c.api.get<PublishedCatalog>('/liekan/crawler-registry', undefined, signal),
          drafts: [],
          history: [],
        },
  );
  const health = useData<CrawlerSourcesResponse>(
    ['crawler-sources', c.user.id],
    signal => c.api.get('/liekan/admin/crawler-sources', undefined, signal),
    admin,
  );
  useEffect(() => {
    setData(undefined);
    setDraftId('');
    setEditor(undefined);
    setSiteOpen(false);
    setRetry(undefined);
    setStale(false);
    setError('');
  }, [c.user.id, admin]);
  useEffect(() => {
    if ([401, 403, 404].includes((query.error as any)?.status)) {
      setData(undefined);
      setDraftId('');
      setEditor(undefined);
    } else if (query.data) setData(query.data);
  }, [query.data, query.error, admin, c.user.id]);
  useEffect(() => {
    setSiteOpen(false);
  }, [siteId]);
  const draft = data?.drafts.find(item => item.id === draftId && item.status === 'draft');
  const payload = draft?.payload || data?.current.payload;
  const editable = admin && !!draft && !busy && !stale && !retry;
  const counts = data && registryCounts(data.current.payload);
  const site = c.sites.find(item => item.id === siteId);
  const team = c.teams.find(item => item.id === site?.teamId);
  const role =
    team?.members?.find((member: any) => member.userId === c.user.id)?.role || team?.role;
  const manageSite =
    !!site &&
    c.user.role !== 'view-only' &&
    (admin ||
      site.userId === c.user.id ||
      (!site.userId && ['team-owner', 'team-manager', 'team-member'].includes(role)));
  const currentRef = useRef({ user: c.user.id, admin });
  currentRef.current = { user: c.user.id, admin };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const freshHealth =
    !health.error && health.data && data && health.data.catalogVersion === data.current.version
      ? health.data.ipSources.filter(item => item.status === 'healthy').length
      : undefined;
  const blocked = busy || stale || !!retry;
  const run = async (command: CrawlerRegistryCommand): Promise<boolean> => {
    if (lock.current || !admin) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    setRetry(command);
    const actor = c.user.id;
    try {
      const result = await c.api.post<CrawlerRegistryCommandResponse>(endpoint, command);
      if (!mounted.current || currentRef.current.user !== actor || !currentRef.current.admin)
        return false;
      setRetry(undefined);
      if (command.action === 'preview') setSampleDirty(false);
      setData(old => ({
        ...old!,
        current: result.current || old!.current,
        drafts: result.draft
          ? [result.draft, ...old!.drafts.filter(item => item.id !== result.draft!.id)]
          : old!.drafts,
      }));
      if (result.draft) setDraftId(result.draft.status === 'draft' ? result.draft.id : '');
      if (result.current) {
        setPublishOpen(false);
        setAcknowledged(false);
        c.notify(i18n.text('爬虫目录已发布'));
      }
      // A confirmed mutation stays successful even if its following read fails.
      void query.refetch();
      return true;
    } catch (failure: any) {
      if (!mounted.current || currentRef.current.user !== actor || !currentRef.current.admin)
        return false;
      if (failure.status === 409) {
        setStale(true);
        setRetry(undefined);
        setError(
          failure.code === 'crawler-draft-base-changed'
            ? i18n.system(failure.message)
            : i18n.text(
                '目录或草稿已更新。请重新读取最新版本，再核对并重新编辑。当前修改尚未覆盖服务器内容。',
              ),
        );
      } else {
        if (failure.status >= 400 && failure.status < 500) setRetry(undefined);
        setError(failure.message || i18n.text('操作失败，请重试'));
      }
      return false;
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const refresh = async () => {
    if (busy || lock.current) return;
    const actor = c.user.id;
    const wasAdmin = admin;
    lock.current = true;
    setBusy(true);
    try {
      const result = await query.refetch();
      if (
        !mounted.current ||
        currentRef.current.user !== actor ||
        currentRef.current.admin !== wasAdmin
      )
        return;
      if (result.error || !result.data) {
        setError(i18n.text('目录读取失败，请重试。'));
        return;
      }
      setData(result.data);
      setStale(false);
      setRetry(undefined);
      setError('');
      setPublishOpen(false);
      setAcknowledged(false);
      // Keep any open editor's input; its captured draft revision is checked on save.
    } finally {
      lock.current = false;
      if (mounted.current && currentRef.current.user === actor) setBusy(false);
    }
  };

  const create = (sourceVersion?: string) =>
    run({
      action: sourceVersion ? 'rollbackDraft' : 'createDraft',
      operationId: crypto.randomUUID(),
      ...(sourceVersion ? { sourceVersion } : {}),
      title: i18n.text(sourceVersion ? '历史版本回滚草稿' : '爬虫目录维护草稿'),
    } as CrawlerRegistryCommand);
  const save = async (next: CatalogPayload, expectedRevision = draft?.revision) => {
    if (!draft || !editable) return false;
    if (expectedRevision !== draft.revision) {
      setStale(true);
      setError(
        i18n.text(
          '目录或草稿已更新。请重新读取最新版本，再核对并重新编辑。当前修改尚未覆盖服务器内容。',
        ),
      );
      return false;
    }
    const parsed = catalogPayloadSchema.safeParse(next);
    if (!parsed.success) {
      setError(i18n.text('请检查字段格式与关联关系。'));
      return false;
    }
    return run({
      action: 'updateDraft',
      operationId: crypto.randomUUID(),
      draftId: draft.id,
      expectedDraftRevision: draft.revision,
      payload: parsed.data,
    });
  };
  const preview = () => {
    if (!draft || blocked) return;
    const positives = positive
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const divider = line.lastIndexOf('|');
        return {
          userAgent: line.slice(0, divider).trim(),
          expectedId: line.slice(divider + 1).trim(),
        };
      });
    if (
      positives.some(
        item =>
          !item.userAgent || !payload.identities.some(identity => identity.id === item.expectedId),
      )
    ) {
      setError(i18n.text('正例须填写 UA | 已登记身份 ID。'));
      return;
    }
    const negatives = negative
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(userAgent => ({ userAgent, expectedId: null }));
    if (!positives.length || !negatives.length) {
      setError(i18n.text('请至少填写一个正例和一个反例，再生成预览。'));
      return;
    }
    void run({
      action: 'preview',
      operationId: crypto.randomUUID(),
      draftId: draft.id,
      expectedDraftRevision: draft.revision,
      samples: [...positives, ...negatives],
    });
  };
  const textMatch = (item: any) =>
    !search ||
    [item.name, item.id, item.host, item.vendor, item.operator, ...(item.aliases || [])].some(
      value =>
        String(value || '')
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  const regionMatch = (platformId: string) =>
    region === 'all' || payload.platforms.find(item => item.id === platformId)?.region === region;
  const label = (value: string) =>
    i18n.system(statusLabels[value] || purposeLabels[value] || formLabels[value] || value);
  const recordActions = (section: CatalogSection, record: any) => (
    <div className="actions">
      <Button
        onClick={() => setEditor({ section, record, draftRevision: draft?.revision })}
        disabled={busy}
      >
        {i18n.text(editable ? '查看与编辑' : '查看详情')}
      </Button>
      {editable &&
        (section !== 'platforms' ||
          !data.current.payload.platforms.some(item => item.id === record.id)) && (
          <Button danger onClick={() => save(removeCatalogRecord(payload, section, record.id))}>
            {i18n.text(section !== 'platforms' ? '停用' : '从草稿移除')}
          </Button>
        )}
    </div>
  );
  const recordTable = (
    section: CatalogSection,
    rows: any[],
    columns: string[],
    cells: (record: any) => React.ReactNode[],
  ) => (
    <Panel
      title={i18n.system(sectionLabels[section])}
      actions={
        admin && (
          <Button
            disabled={!editable}
            onClick={() => setEditor({ section, draftRevision: draft?.revision })}
          >
            {i18n.text('新增{v0}', [i18n.system(sectionLabels[section])])}
          </Button>
        )
      }
    >
      <RegistryTable
        mobile
        columns={[...columns.map(value => i18n.system(value)), i18n.text('操作')]}
        rowKeys={rows.map(item => item.id)}
        rows={rows.map(item => [...cells(item), recordActions(section, item)])}
        empty={i18n.text('当前筛选下没有记录')}
      />
    </Panel>
  );
  const previewReady =
    draft?.preview &&
    !sampleDirty &&
    draft.preview.draftRevision === draft.revision &&
    draft.preview.currentRevision === data.current.revision &&
    !draft.preview.conflicts.length &&
    draft.preview.samples.some(sample => sample.expectedId) &&
    draft.preview.samples.some(sample => sample.expectedId === null) &&
    draft.preview.samples.every(sample => sample.passed);
  if (!data)
    return (
      <Panel title={i18n.text('爬虫与 AI 平台')}>
        <Body>
          <Notice tone={query.error ? 'red' : ''}>
            {i18n.text(query.error ? '目录读取失败，请重试。' : '正在读取爬虫目录。')}
          </Notice>
          <Button disabled={query.isFetching} onClick={refresh}>
            {i18n.text('重新读取')}
          </Button>
        </Body>
      </Panel>
    );
  return (
    <div className="registry-page">
      <Panel
        title={i18n.text('爬虫与 AI 平台')}
        subtitle={i18n.text('统一维护身份、产品与引荐；网站识别规则按网站权限管理。')}
        actions={
          <Button disabled={busy || query.isFetching} onClick={refresh}>
            {i18n.text('重新读取')}
          </Button>
        }
      >
        <Body>
          <Definition
            items={[
              [i18n.text('发布版本'), `${data.current.revision} · ${data.current.version}`],
              [i18n.text('目录状态'), label(data.current.state)],
            ]}
          />
          {admin ? (
            <div className="registry-toolbar">
              <Select
                label={i18n.text('编辑版本')}
                value={draftId}
                disabled={blocked}
                onChange={e => {
                  setDraftId(e.target.value);
                  setEditor(undefined);
                  setPositive('');
                  setNegative('');
                  setSampleDirty(false);
                  setAcknowledged(false);
                }}
                options={[
                  ['', i18n.text('当前发布目录')],
                  ...data.drafts
                    .filter(item => item.status === 'draft')
                    .map(
                      item => [item.id, `${item.title} · r${item.revision}`] as [string, string],
                    ),
                ]}
              />
              <Button disabled={blocked} primary onClick={() => create()}>
                {i18n.text('新建草稿')}
              </Button>
              {draft && (
                <Badge tone="amber">
                  {i18n.text('草稿修订 {v0} · 基于发布修订 {v1}', [
                    draft.revision,
                    draft.baseRevision,
                  ])}
                </Badge>
              )}
            </div>
          ) : (
            <Notice>{i18n.text('当前为只读目录。系统管理员可在草稿中修改并预览发布。')}</Notice>
          )}
          {draft && (
            <Notice>{i18n.text('编辑内容逐次保存到服务器草稿；发布前保持现行目录生效。')}</Notice>
          )}
          {error && (
            <Notice tone="red">
              {i18n.system(error)}
              {stale && (
                <Button onClick={refresh} disabled={busy}>
                  {i18n.text('重新读取最新版本')}
                </Button>
              )}
              {retry && (
                <Button onClick={() => run(retry)} disabled={busy}>
                  {i18n.text('重试同一操作')}
                </Button>
              )}
            </Notice>
          )}
          {query.error && (
            <Notice tone="amber">{i18n.text('最新读取失败，正在显示上次读取结果。')}</Notice>
          )}
        </Body>
      </Panel>
      <Metrics
        items={[
          [i18n.text('平台数'), counts.platforms, i18n.text('平台档案独立计数')],
          [i18n.text('有效身份数'), counts.identities, i18n.text('启用的网络身份')],
          [i18n.text('具备核验方法'), counts.capable, i18n.text('能力配置数，不代表请求已核验')],
          [
            i18n.text('新鲜范围来源'),
            admin ? (freshHealth ?? i18n.text('未知')) : i18n.text('管理员可见'),
            i18n.text('以当前发布版本的维护状态为准'),
          ],
          [i18n.text('待核实条目'), counts.pending, i18n.text('产品与身份待核实队列')],
        ]}
      />
      <Tabs
        items={[
          ['library', i18n.text('爬虫库')],
          ['platforms', i18n.text('平台与引荐')],
          ['sources', i18n.text('来源与核验')],
          ['changes', i18n.text('待核实与变更')],
        ]}
        active={tab}
        onChange={next => {
          setTab(next);
          setEditor(undefined);
          c.updateQuery?.({ tab: next });
        }}
      />
      <div className="registry-toolbar">
        <Field
          type="search"
          label={i18n.text('搜索目录')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select
          label={i18n.text('业务筛选')}
          value={business}
          onChange={e => setBusiness(e.target.value)}
          options={Object.entries({
            all: '全部',
            training: 'AI 训练',
            search: 'AI 搜索',
            user: '用户触发',
            workbench: 'AI 工作台',
            personal_agent: '个人 Agent',
            traditional_search: '传统搜索',
            other: '其他',
          }).map(([id, name]) => [id, i18n.system(name)])}
        />
        <Select
          label={i18n.text('服务区域')}
          value={region}
          onChange={e => setRegion(e.target.value)}
          options={[
            ['all', i18n.text('全部')],
            ['domestic', i18n.text('国内')],
            ['global', i18n.text('全球')],
          ]}
        />
      </div>
      <p className="field-help">
        {i18n.text('业务筛选分别使用用途和产品形态；交叉类别保持独立，不相加为总量。')}
      </p>
      {tab === 'library' && (
        <>
          {recordTable(
            'identities',
            payload.identities.filter(
              item =>
                textMatch(item) &&
                regionMatch(item.platformId) &&
                matchesBusinessFilter(item, business),
            ),
            ['身份', '平台', '用途', '产品形态', '证据与状态', '核验能力'],
            item => [
              <div key="name">
                <strong>{item.name}</strong>
                <p className="field-help">{item.uaSelector || item.robotsToken || item.id}</p>
              </div>,
              payload.platforms.find(platform => platform.id === item.platformId)?.name ||
                item.platformId,
              label(item.purpose),
              label(item.productForm),
              <div key="status">
                <Badge>{label(item.status)}</Badge>
                <p className="field-help">{label(item.metadata.evidence)}</p>
              </div>,
              [
                ...(payload.rangeSources.some(
                  source => source.enabled !== false && source.crawlerIds.includes(item.id),
                )
                  ? [i18n.text('官方 IP 范围')]
                  : []),
                ...payload.verificationMethods
                  .filter(method => method.enabled !== false && method.crawlerIds.includes(item.id))
                  .map(method => label(method.method)),
              ].join(' / ') || i18n.text('缺少识别能力'),
            ],
          )}
          <Panel
            title={i18n.text('网站识别设置')}
            subtitle={i18n.text(
              '网站停用和自定义规则仅影响该网站的识别；浏览器自动化排除仍由全局政策决定。',
            )}
          >
            <Body>
              <div className="registry-toolbar">
                <Select
                  label={i18n.text('选择网站')}
                  value={siteId}
                  disabled={c.sitesLoading}
                  onChange={e => {
                    setSiteId(e.target.value);
                    c.updateQuery?.({ site: e.target.value || undefined });
                  }}
                  options={[
                    ['', i18n.text('请选择网站')],
                    ...c.sites.map(item => [item.id, item.name] as [string, string]),
                  ]}
                />
                <Button
                  disabled={!site || !manageSite || !!draft || busy}
                  onClick={() => setSiteOpen(true)}
                >
                  {i18n.text('编辑网站识别规则')}
                </Button>
              </div>
              {draft && <Notice>{i18n.text('切换至当前发布目录后可编辑网站规则。')}</Notice>}
              {site && !manageSite && <Notice>{i18n.text('当前网站为只读权限。')}</Notice>}
            </Body>
          </Panel>
        </>
      )}
      {tab === 'platforms' && (
        <>
          {recordTable(
            'platforms',
            payload.platforms.filter(
              item => textMatch(item) && (region === 'all' || region === item.region),
            ),
            ['平台', '运营主体', '服务区域', '官方网站'],
            item => [
              item.name,
              item.operator,
              label(item.region),
              <a key="url" href={item.website} target="_blank" rel="noopener noreferrer">
                {item.website}
              </a>,
            ],
          )}
          {recordTable(
            'products',
            payload.products.filter(
              item =>
                textMatch(item) &&
                regionMatch(item.platformId) &&
                (business === 'all' ||
                  item.form === business ||
                  payload.identities.some(
                    identity =>
                      item.identityIds.includes(identity.id) &&
                      matchesBusinessFilter(identity, business),
                  )),
            ),
            ['产品', '平台', '产品形态', '支持状态', '关联身份'],
            item => [
              item.name,
              payload.platforms.find(platform => platform.id === item.platformId)?.name ||
                item.platformId,
              label(item.form),
              <Badge key="status">{label(item.supportStatus)}</Badge>,
              item.identityIds.length
                ? item.identityIds
                    .map(id => payload.identities.find(identity => identity.id === id)?.name || id)
                    .join(' / ')
                : i18n.text('缺少识别能力'),
            ],
          )}
          {recordTable(
            'referrals',
            payload.referrals.filter(item => textMatch(item) && regionMatch(item.platformId)),
            ['引荐主机', '平台', '关联产品', '来源种类', '匹配边界', '状态'],
            item => [
              item.host,
              payload.platforms.find(platform => platform.id === item.platformId)?.name ||
                item.platformId,
              payload.products.find(product => product.id === item.productId)?.name ||
                i18n.text('产品未细分'),
              label(item.kind),
              i18n.text(item.includeSubdomains ? '主机及子域名' : '精确主机'),
              i18n.text(item.enabled ? '启用' : '停用'),
            ],
          )}
        </>
      )}
      {tab === 'sources' && (
        <>
          {recordTable(
            'rangeSources',
            payload.rangeSources.filter(textMatch),
            ['来源', '官方地址', '适用身份', '人工复核日期', '状态'],
            item => [
              item.names.join(' / '),
              <a key="url" href={item.url} target="_blank" rel="noopener noreferrer">
                {item.url}
              </a>,
              item.crawlerIds.join(' / '),
              item.reviewedAt,
              i18n.text(item.enabled === false ? '停用' : '启用'),
            ],
          )}
          {recordTable(
            'verificationMethods',
            payload.verificationMethods.filter(textMatch),
            ['核验方法', '适用身份', '官方说明', '状态'],
            item => [
              label(item.method),
              item.crawlerIds.join(' / '),
              <a key="url" href={item.documentationUrl} target="_blank" rel="noopener noreferrer">
                {item.documentationUrl}
              </a>,
              i18n.text(item.enabled === false ? '停用' : '启用'),
            ],
          )}
          <Notice>
            {i18n.text('签名资料用于记录官方方法；请求核验需要可信输入与已接入的核验能力。')}
          </Notice>
          {admin && <CrawlerSourcesPanel />}
        </>
      )}
      {tab === 'changes' && (
        <>
          <Panel title={i18n.text('待核实队列')}>
            <Table
              mobile
              columns={['条目', '种类', '状态', '操作'].map(text => i18n.system(text))}
              rowKeys={[
                ...payload.identities
                  .filter(item => item.status === 'pending')
                  .map(item => `identity:${item.id}`),
                ...payload.products
                  .filter(item => item.supportStatus === 'pending')
                  .map(item => `product:${item.id}`),
              ]}
              rows={[
                ...payload.identities
                  .filter(item => item.status === 'pending')
                  .map(item => [
                    item.name,
                    i18n.text('爬虫身份'),
                    i18n.text('待核实'),
                    recordActions('identities', item),
                  ]),
                ...payload.products
                  .filter(item => item.supportStatus === 'pending')
                  .map(item => [
                    item.name,
                    i18n.text('产品'),
                    i18n.text('缺少识别能力'),
                    recordActions('products', item),
                  ]),
              ]}
              empty={i18n.text('没有待核实条目')}
            />
          </Panel>
          {admin && draft && (
            <Panel
              title={i18n.text('样本与发布预览')}
              subtitle={i18n.text('样本仅用于规则测试，不计入生产流量。')}
            >
              <Body>
                <div className="two">
                  <Textarea
                    label={i18n.text('正例 UA')}
                    aria-label={i18n.text('正例 UA')}
                    help={i18n.text('每行填写 UA | 已登记身份 ID')}
                    rows={4}
                    value={positive}
                    disabled={blocked}
                    onChange={e => {
                      setPositive(e.target.value);
                      setSampleDirty(true);
                    }}
                  />
                  <Textarea
                    label={i18n.text('反例 UA')}
                    aria-label={i18n.text('反例 UA')}
                    help={i18n.text('每行填写一个预期不命中任何身份的 UA')}
                    rows={4}
                    value={negative}
                    disabled={blocked}
                    onChange={e => {
                      setNegative(e.target.value);
                      setSampleDirty(true);
                    }}
                  />
                </div>
                <Button disabled={blocked} onClick={preview}>
                  {i18n.text('生成匹配与变更预览')}
                </Button>
                {draft.conflicts.length > 0 && (
                  <Notice tone="red">
                    {draft.conflicts.map((conflict, index) => (
                      <p key={index}>{conflict}</p>
                    ))}
                  </Notice>
                )}
                {draft.preview && <Preview draft={draft} />}
                {draft.preview && (
                  <Button
                    primary
                    disabled={blocked || !previewReady}
                    onClick={() => {
                      setAcknowledged(false);
                      setPublishOpen(true);
                    }}
                  >
                    {i18n.text('核对并发布')}
                  </Button>
                )}
              </Body>
            </Panel>
          )}
          {admin && !draft && (
            <Notice>{i18n.text('新建或选择草稿后，可运行样本测试、预览差异与发布。')}</Notice>
          )}
          {admin && (
            <Panel
              title={i18n.text('发布历史')}
              subtitle={i18n.text('回滚先创建草稿；核对差异和样本后再发布新版本。')}
            >
              <Table
                mobile
                columns={['修订', '发布时间', '来源', '操作'].map(text => i18n.system(text))}
                rowKeys={data.history.map(item => item.version)}
                rows={data.history.map(item => [
                  item.revision,
                  new Intl.DateTimeFormat(i18n.locale, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: c.range.timezone,
                  }).format(new Date(item.publishedAt)),
                  label(item.action),
                  <Button
                    key="rollback"
                    disabled={blocked || item.version === data.current.version}
                    onClick={() => create(item.version)}
                  >
                    {i18n.text('创建回滚草稿')}
                  </Button>,
                ])}
              />
            </Panel>
          )}
        </>
      )}
      {editor && (
        <CrawlerRegistryRecord
          key={`${draftId}:${editor.section}:${editor.record?.id || 'new'}`}
          {...editor}
          payload={payload}
          editable={!!draft && admin && !stale && !retry}
          busy={busy}
          onSave={next => save(next, editor.draftRevision)}
          requestError={error}
          retryAction={
            retry
              ? async () => {
                  const saved = await run(retry);
                  if (saved) setEditor(undefined);
                  return saved;
                }
              : undefined
          }
          onReload={stale ? refresh : undefined}
          onClose={() => !busy && setEditor(undefined)}
        />
      )}
      {siteOpen && site && (
        <ManagementDrawer
          key={site.id}
          action="特征库管理"
          websiteId={site.id}
          websiteName={site.name}
          websiteDomain={site.domain}
          canManage={manageSite}
          centralCatalog={data.current.payload}
          onClose={() => setSiteOpen(false)}
          onSaved={() => c.refresh()}
          onSearch={() => {}}
          onRange={() => {}}
        />
      )}
      {publishOpen && draft?.preview && (
        <LiekanDialog
          title={i18n.text('确认发布爬虫目录')}
          onClose={() => !busy && setPublishOpen(false)}
        >
          <Notice tone="amber">
            {i18n.text('发布将切换全局目录。日志分类、引荐和后续采集将读取新版本。')}
          </Notice>
          <Preview draft={draft} />
          <Check
            checked={acknowledged}
            disabled={busy}
            onChange={e => setAcknowledged(e.target.checked)}
          >
            {i18n.text('已核对差异、正反例和影响范围')}
          </Check>
          <DialogActions>
            <Button disabled={busy} onClick={() => setPublishOpen(false)}>
              {i18n.text('取消')}
            </Button>
            <Button
              primary
              disabled={!acknowledged || !previewReady || blocked}
              onClick={() =>
                run({
                  action: 'publish',
                  operationId: crypto.randomUUID(),
                  draftId: draft.id,
                  expectedDraftRevision: draft.revision,
                  expectedCurrentRevision: data.current.revision,
                  previewHash: draft.preview.hash,
                })
              }
            >
              {i18n.text('确认发布')}
            </Button>
          </DialogActions>
        </LiekanDialog>
      )}
    </div>
  );
}
function Preview({ draft }: { draft: RegistryDraft }) {
  const i18n = useLiekanI18n(),
    preview = draft.preview;
  return (
    <section aria-label={i18n.text('发布预览')}>
      <p>
        {i18n.text('新增 {v0} · 修改 {v1} · 停用或移除 {v2}', [
          preview.counts.added,
          preview.counts.changed,
          preview.counts.disabled,
        ])}
      </p>
      <p className="field-help">
        {i18n.text('预览基于发布修订 {v0}、草稿修订 {v1}', [
          preview.currentRevision,
          preview.draftRevision,
        ])}
      </p>
      {preview.conflicts.length > 0 && (
        <Notice tone="red">
          {preview.conflicts.map((conflict, index) => (
            <p key={index}>{conflict}</p>
          ))}
        </Notice>
      )}
      <Table
        columns={['类型', '稳定 ID', '变更'].map(text => i18n.system(text))}
        rows={preview.changes.map(item => [
          i18n.system(sectionLabels[item.section] || item.section),
          item.id,
          i18n.system(statusLabels[item.kind]),
        ])}
      />
      <Table
        columns={['UA 样本', '预期身份', '匹配身份', '测试结果'].map(text => i18n.system(text))}
        rows={preview.samples.map(item => [
          item.userAgent,
          item.expectedId || i18n.text('无匹配'),
          item.matchedId || i18n.text('无匹配'),
          <Badge key="result" tone={item.passed ? 'green' : 'red'}>
            {i18n.text(item.passed ? '通过' : '未通过')}
          </Badge>,
        ])}
      />
    </section>
  );
}

function RegistryTable(props: ComponentProps<typeof Table>) {
  const [page, setPage] = useState(1);
  const identity = JSON.stringify(props.rowKeys);
  useEffect(() => setPage(1), [identity]);
  const pages = Math.max(1, Math.ceil(props.rows.length / 30));
  const visiblePage = Math.min(page, pages);
  return (
    <Table
      {...props}
      rows={props.rows.slice((visiblePage - 1) * 30, visiblePage * 30)}
      rowKeys={props.rowKeys?.slice((visiblePage - 1) * 30, visiblePage * 30)}
      page={visiblePage}
      pages={pages}
      onPage={setPage}
    />
  );
}
