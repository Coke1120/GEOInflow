import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CatalogIdentity,
  CatalogPayload,
  CrawlerRegistryResponse,
  RegistryDraft,
} from '@/lib/liekan/contracts/crawler-registry';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { CrawlerRegistryRecord } from './CrawlerRegistryRecord';
import { CrawlerRulesEditor } from './CrawlerRulesEditor';
import { CrawlerRegistryPage } from './CrawlerRegistryPage';
import {
  catalogBotRules,
  matchesBusinessFilter,
  registryCounts,
  removeCatalogRecord,
  updateCatalogRecord,
} from './crawlerRegistryUi';
import { featureHref, featureNavigationHref, matchFeatureRoute } from './routes';

const h = vi.hoisted(() => ({
  admin: true,
  data: undefined as CrawlerRegistryResponse,
  post: vi.fn(),
  get: vi.fn(),
  refetch: vi.fn(),
  query: {} as Record<string, string>,
  calls: [] as any[],
  health: undefined as any,
}));
vi.mock('./context', () => ({
  useFeature: () => ({
    user: { id: 'user-a', isAdmin: h.admin, role: 'user' },
    query: h.query,
    range: { timezone: 'UTC' },
    api: { post: h.post, get: h.get },
    sites: [
      { id: 'site-a', name: 'Site A', userId: 'user-a' },
      { id: 'site-b', name: 'Site B', userId: 'other-user' },
    ],
    teams: [],
    updateQuery: vi.fn(),
    refresh: vi.fn(),
    notify: vi.fn(),
  }),
  useData: (key: any[], load: any, enabled = true) => {
    h.calls.push({ key, load, enabled });
    return {
      data: key[0] === 'crawler-registry' ? h.data : h.health,
      refetch: h.refetch,
      isFetching: false,
      error: null,
    };
  },
}));
vi.mock('../ManagementDrawer', () => ({
  ManagementDrawer: ({ websiteId, centralCatalog }: any) => (
    <div role="dialog" aria-label={`Rules ${websiteId}`}>
      {centralCatalog.identities[0].id}
    </div>
  ),
}));
vi.mock('./CrawlerSourcesPanel', () => ({
  CrawlerSourcesPanel: () => <div>Private source health</div>,
}));
const identity: CatalogIdentity = {
  id: 'fixture-bot',
  name: 'FixtureBot',
  platformId: 'fixture',
  vendor: 'Fixture',
  type: 'search',
  kind: 'http_crawler',
  uaSelector: 'FixtureBot',
  family: 'fixture-bot',
  parentId: null,
  aiEligible: true,
  status: 'active',
  control: { remote: false, nginx: false },
  robotsToken: 'FixtureBot',
  purpose: 'search',
  productForm: 'workbench',
  productIds: [],
  metadata: {
    id: 'fixture-bot',
    name: 'FixtureBot',
    vendor: 'Fixture',
    aliases: [],
    purposes: ['AI 搜索'],
    kind: 'crawler',
    evidence: 'operator',
    summary: 'Recorded evidence',
    ua: 'FixtureBot/1.0',
    token: 'FixtureBot',
    feeds: [],
    verification: 'Official ranges',
    robots: '',
    advice: '',
    sources: [{ label: 'Official', url: 'https://fixture.org/docs' }],
    reviewedAt: '2026-10-01',
  },
};
const payload: CatalogPayload = {
  schemaVersion: 1,
  identities: [identity],
  platforms: [
    {
      id: 'fixture',
      name: 'Fixture',
      operator: 'Fixture',
      region: 'global',
      website: 'https://fixture.org',
      documentationUrls: [],
    },
  ],
  products: [
    {
      id: 'fixture-product',
      name: 'Fixture Workbench',
      platformId: 'fixture',
      aliases: [],
      form: 'workbench',
      supportStatus: 'pending',
      website: 'https://fixture.org',
      documentationUrls: [],
      identityIds: [],
      tags: [],
      notes: '',
    },
  ],
  referrals: [],
  rangeSources: [],
  rangeBaselines: {},
  verificationMethods: [],
};
const draft: RegistryDraft = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Saved draft',
  revision: '1',
  baseVersion: '11111111-1111-4111-8111-111111111111',
  baseRevision: '1',
  status: 'draft',
  payload,
  conflicts: [],
  preview: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
function fixture() {
  return structuredClone({
    current: {
      version: draft.baseVersion,
      revision: '1',
      contentHash: 'a'.repeat(64),
      publishedAt: '2026-10-01T00:00:00Z',
      payload,
      state: 'published',
    },
    drafts: [draft],
    history: [
      {
        version: draft.baseVersion,
        revision: '1',
        contentHash: 'a'.repeat(64),
        publishedAt: '2026-10-01T00:00:00Z',
        actorId: null,
        action: 'seed',
      },
    ],
  }) as CrawlerRegistryResponse;
}
beforeEach(() => {
  h.admin = true;
  h.data = fixture();
  h.query = {};
  h.calls = [];
  h.health = undefined;
  h.post.mockReset();
  h.get.mockReset();
  h.refetch.mockReset().mockImplementation(async () => ({ data: h.data }));
});
function chooseDraft() {
  fireEvent.change(screen.getByRole('combobox', { name: '编辑版本' }), {
    target: { value: draft.id },
  });
}
describe('catalog contracts for management UI', () => {
  it('treats purpose and product form as independent filters and counts identities once', () => {
    expect(matchesBusinessFilter(identity, 'search')).toBe(true);
    expect(matchesBusinessFilter(identity, 'workbench')).toBe(true);
    expect(matchesBusinessFilter(identity, 'training')).toBe(false);
    expect(registryCounts(payload)).toEqual({
      platforms: 1,
      identities: 1,
      capable: 0,
      pending: 1,
    });
  });
  it('links products reciprocally and preserves identities when disabling', () => {
    const next = updateCatalogRecord(payload, 'identities', {
      ...identity,
      productIds: ['fixture-product'],
    });
    expect(next.products[0].identityIds).toEqual([identity.id]);
    expect(removeCatalogRecord(next, 'identities', identity.id).identities[0].status).toBe(
      'inactive',
    );
    expect(catalogBotRules(next)[0].crawlerId).toBe(identity.id);
  });
  it('clears website conditions on the unique global route', () => {
    expect(
      matchFeatureRoute('/crawlers/manage', { websiteId: 'foreign-site', botId: 'bot' }),
    ).toEqual({ page: 'crawlers-manage' });
    expect(
      featureNavigationHref(
        { page: 'geo-bots', websiteId: 'site' },
        { path: '/private', botId: 'bot' },
        'crawlers-manage',
      ),
    ).toBe('/crawlers/manage');
    expect(featureHref('crawlers-manage', { tab: 'sources' })).toBe('/crawlers/manage?tab=sources');
  });
});
it('provides ordinary users a safe catalog and no private health or global writes', async () => {
  h.admin = false;
  render(<CrawlerRegistryPage />);
  expect(await screen.findByRole('tab', { name: '爬虫库' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '新建草稿' })).toBeNull();
  expect(screen.getByText('管理员可见')).toBeVisible();
  expect(
    h.calls.filter(call => call.key[0] === 'crawler-sources').every(call => call.enabled === false),
  ).toBe(true);
  h.get.mockResolvedValue(h.data.current);
  const safeRead = h.calls.find(call => call.key[0] === 'crawler-registry');
  await safeRead.load(new AbortController().signal);
  expect(h.get).toHaveBeenCalledWith(
    '/liekan/crawler-registry',
    undefined,
    expect.any(AbortSignal),
  );
});
it('keeps one operation ID across an uncertain create retry', async () => {
  h.post.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({
    action: 'createDraft',
    draft: { ...draft, id: '44444444-4444-4444-8444-444444444444' },
  });
  render(<CrawlerRegistryPage />);
  fireEvent.click(await screen.findByRole('button', { name: '新建草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试同一操作' }));
  await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2));
  expect(h.post.mock.calls[0][1].operationId).toBe(h.post.mock.calls[1][1].operationId);
});
it('shows a revision conflict and requires reload before editing again', async () => {
  h.post.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }));
  render(<CrawlerRegistryPage />);
  await screen.findByRole('button', { name: '新建草稿' });
  chooseDraft();
  fireEvent.click(screen.getByRole('button', { name: '停用' }));
  expect(await screen.findByText(/目录或草稿已更新/)).toBeVisible();
  expect(screen.getByRole('button', { name: '新建草稿' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重新读取最新版本' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '新建草稿' })).toBeEnabled());
});
it('locks editing while a manual reload is pending', async () => {
  let finish: (value: { data: CrawlerRegistryResponse }) => void;
  h.refetch.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  render(<CrawlerRegistryPage />);
  await screen.findByRole('button', { name: '新建草稿' });
  chooseDraft();
  expect(screen.getByRole('button', { name: /查看与编辑|查看详情/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  expect(screen.getByRole('button', { name: /查看与编辑|查看详情/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '新建草稿' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /查看与编辑|查看详情/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => finish({ data: h.data }));
  expect(screen.getByRole('button', { name: /查看与编辑|查看详情/ })).toBeEnabled();
});
it('requires positive and negative samples, then a reviewed preview before publishing', async () => {
  render(<CrawlerRegistryPage />);
  await screen.findByRole('button', { name: '新建草稿' });
  chooseDraft();
  fireEvent.click(screen.getByRole('tab', { name: '待核实与变更' }));
  fireEvent.click(screen.getByRole('button', { name: '生成匹配与变更预览' }));
  expect(screen.getByText('请至少填写一个正例和一个反例，再生成预览。')).toBeVisible();
  expect(h.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('正例 UA'), {
    target: { value: 'FixtureBot/1.0 | fixture-bot' },
  });
  fireEvent.change(screen.getByLabelText('反例 UA'), { target: { value: 'Mozilla/5.0' } });
  const preview = {
    hash: 'b'.repeat(64),
    currentRevision: '1',
    draftRevision: '1',
    contentHash: 'c'.repeat(64),
    changes: [],
    counts: { added: 0, changed: 0, disabled: 0 },
    conflicts: [],
    samples: [
      {
        userAgent: 'FixtureBot/1.0',
        expectedId: 'fixture-bot',
        matchedId: 'fixture-bot',
        passed: true,
      },
      { userAgent: 'Mozilla/5.0', expectedId: null, matchedId: null, passed: true },
    ],
  };
  h.post.mockResolvedValueOnce({ action: 'preview', draft: { ...draft, preview }, preview });
  h.refetch.mockImplementation(async () => ({ data: h.data }));
  fireEvent.click(screen.getByRole('button', { name: '生成匹配与变更预览' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对并发布' }));
  const confirm = await screen.findByRole('button', { name: '确认发布' });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByLabelText('已核对差异、正反例和影响范围'));
  expect(confirm).toBeEnabled();
  h.post.mockResolvedValueOnce({
    action: 'publish',
    current: { ...h.data.current, revision: '2' },
    draft: { ...draft, status: 'published', preview },
  });
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(h.post.mock.calls[1][1]).toMatchObject({
      action: 'publish',
      expectedCurrentRevision: '1',
      previewHash: 'b'.repeat(64),
    }),
  );
});
it('clears site editing when the selected website changes and respects read-only ownership', async () => {
  h.admin = false;
  render(<CrawlerRegistryPage />);
  const selector = await screen.findByRole('combobox', { name: '选择网站' });
  fireEvent.change(selector, { target: { value: 'site-a' } });
  fireEvent.click(screen.getByRole('button', { name: '编辑网站识别规则' }));
  expect(screen.getByRole('dialog', { name: 'Rules site-a' })).toHaveTextContent('fixture-bot');
  fireEvent.change(selector, { target: { value: 'site-b' } });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: '编辑网站识别规则' })).toBeDisabled();
});
it('keeps missing source health unknown and renders the new English interface', async () => {
  render(
    <LiekanLocaleContext.Provider value="en-US">
      <CrawlerRegistryPage />
    </LiekanLocaleContext.Provider>,
  );
  expect(await screen.findByRole('tab', { name: 'Sources and verification' })).toBeVisible();
  expect(screen.getByText('Unknown')).toBeVisible();
  expect(screen.getByRole('button', { name: 'New draft' })).toBeVisible();
});

it.each(['manual-reviewed-v1', 'prefixes-v1', 'amazon-code-json-v1'] as const)(
  'saves the reviewed initial baseline for %s with its actual observation time',
  async parserVersion => {
    const source = {
      id: 'manual-source',
      url: 'https://fixture.org/ips',
      names: ['FixtureBot'],
      crawlerIds: ['fixture-bot'],
      parserVersion,
      reviewedAt: '2026-10-01',
    };
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <CrawlerRegistryRecord
        section="rangeSources"
        record={source}
        payload={{ ...payload, rangeSources: [source] }}
        editable
        busy={false}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('已审核 CIDR 范围'), {
      target: { value: '8.8.8.0/24' },
    });
    fireEvent.change(screen.getByLabelText(/实际观测时间/), {
      target: { value: '2026-10-01T12:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到草稿' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].rangeBaselines['manual-source']).toEqual({
      source: source.url,
      observedAt: '2026-10-01T12:00:00.000Z',
      publishedAt: null,
      prefixes: ['8.8.8.0/24'],
    });
  },
);
it('preserves a reviewed automatic baseline and requires new evidence after changing its URL', async () => {
  const source = {
    id: 'automatic-source',
    url: 'https://fixture.org/ips',
    names: ['FixtureBot'],
    crawlerIds: ['fixture-bot'],
    parserVersion: 'prefixes-v1' as const,
    reviewedAt: '2026-10-01',
  };
  const baseline = {
    source: source.url,
    observedAt: '2026-10-01T12:00:23+08:00',
    publishedAt: '2026-10-01T01:00:00Z',
    prefixes: ['8.8.8.0/24'],
  };
  const onSave = vi.fn().mockResolvedValue(false);
  render(
    <CrawlerRegistryRecord
      section="rangeSources"
      record={source}
      payload={{ ...payload, rangeSources: [source], rangeBaselines: { [source.id]: baseline } }}
      editable
      busy={false}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  expect(screen.getByLabelText(/实际观测时间/)).toHaveValue('2026-10-01T04:00');
  fireEvent.click(screen.getByRole('button', { name: '保存到草稿' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0].rangeBaselines[source.id]).toEqual(baseline);
  fireEvent.change(screen.getByDisplayValue(source.url), {
    target: { value: 'https://fixture.org/new-ips' },
  });
  expect(screen.getByLabelText('已审核 CIDR 范围')).toHaveValue('');
  expect(screen.getByLabelText(/实际观测时间/)).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: '保存到草稿' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('已审核 CIDR 范围'), {
    target: { value: '9.9.9.0/24' },
  });
  fireEvent.change(screen.getByLabelText(/实际观测时间/), {
    target: { value: '2026-10-02T06:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存到草稿' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1][0].rangeBaselines[source.id]).toEqual({
    source: 'https://fixture.org/new-ips',
    observedAt: '2026-10-02T06:00:00.000Z',
    publishedAt: null,
    prefixes: ['9.9.9.0/24'],
  });
});
it('uses the published dynamic and signed identities in website rule toggles', () => {
  const signed = {
    ...identity,
    id: 'signed-agent',
    name: 'SignedAgent',
    kind: 'signed_agent' as const,
    uaSelector: null,
  };
  const catalog = { ...payload, identities: [identity, signed] };
  const onChange = vi.fn();
  render(
    <CrawlerRulesEditor
      content={JSON.stringify({
        mode: 'official',
        disabledIds: [],
        overrides: {},
        customRules: [],
      })}
      disabled={false}
      officialRules={catalogBotRules(catalog)}
      knownIds={catalog.identities.map(item => item.id)}
      onChange={onChange}
      onConversionConfirmed={() => {}}
    />,
  );
  fireEvent.click(screen.getByLabelText('启用 SignedAgent'));
  expect(JSON.parse(onChange.mock.calls[0][0]).disabledIds).toEqual(['signed-agent']);
  expect(screen.getByText('签名身份')).toBeVisible();
});
it('keeps signed and inactive catalog identities disabled in a confirmed conversion', () => {
  const signed = {
    ...identity,
    id: 'signed-agent',
    name: 'SignedAgent',
    kind: 'signed_agent' as const,
    uaSelector: null,
  };
  const catalog = {
    ...payload,
    identities: [
      identity,
      signed,
      { ...signed, id: 'inactive-agent', status: 'inactive' as const },
    ],
  };
  const choices = catalogBotRules(catalog);
  expect(choices.find(item => item.crawlerId === 'signed-agent')).not.toHaveProperty('pattern');
  const onChange = vi.fn();
  render(
    <CrawlerRulesEditor
      content={JSON.stringify({ mode: 'disabled' })}
      disabled={false}
      officialRules={choices}
      knownIds={catalog.identities.map(item => item.id)}
      onChange={onChange}
      onConversionConfirmed={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '预览转换为官方目录' }));
  fireEvent.click(screen.getByLabelText('已核对转换差异与匹配行为变化'));
  fireEvent.click(screen.getByRole('button', { name: '确认转换草稿' }));
  expect(JSON.parse(onChange.mock.calls[0][0])).toMatchObject({
    mode: 'official',
    disabledIds: [identity.id, 'signed-agent', 'inactive-agent'],
  });
});
it('rejects an existing stable ID in the add form without replacing its record', async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const view = render(
    <CrawlerRegistryRecord
      section="platforms"
      payload={payload}
      editable
      busy={false}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText(/稳定 ID/), { target: { value: 'fixture' } });
  fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: 'Replacement' } });
  fireEvent.change(screen.getByLabelText(/^运营主体/), { target: { value: 'Replacement' } });
  fireEvent.change(screen.getByLabelText(/^官方网站/), {
    target: { value: 'https://fixture.org' },
  });
  fireEvent.submit(view.container.querySelector('form') || document.querySelector('form'));
  expect(await screen.findByText('稳定 ID 已存在，请使用新的 ID。')).toBeVisible();
  expect(onSave).not.toHaveBeenCalled();
});

it('protects edited registry input on close and blocks dismissal during a save', async () => {
  const close = vi.fn();
  const view = render(
    <CrawlerRegistryRecord
      section="identities"
      record={identity}
      payload={payload}
      editable
      busy={false}
      onSave={vi.fn()}
      onClose={close}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: 'EditedFixtureBot' } });
  expect(document.querySelector('form[data-unsaved="true"]')).not.toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: '关闭' }).at(-1)!);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText('放弃未保存的修改？')).toBeInTheDocument();
  view.rerender(
    <CrawlerRegistryRecord
      section="identities"
      record={identity}
      payload={payload}
      editable
      busy
      onSave={vi.fn()}
      onClose={close}
    />,
  );
  expect(document.querySelector('form[aria-busy="true"]')).not.toBeNull();
});
