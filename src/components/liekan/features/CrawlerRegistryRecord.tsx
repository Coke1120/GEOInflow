'use client';
import { useEffect, useId, useState } from 'react';
import { useDialog } from './LiekanDialog';
import { catalogPayloadSchema, type CatalogPayload } from '@/lib/liekan/contracts/crawler-registry';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import {
  Badge,
  Button,
  Check,
  Definition,
  DialogActions,
  Field,
  LiekanDialog,
  Notice,
  Select,
  Textarea,
} from './ui';
import {
  type CatalogSection,
  formLabels,
  purposeLabels,
  sectionLabels,
  statusLabels,
  typeLabels,
  updateCatalogRecord,
} from './crawlerRegistryUi';

const lines = (value: string) =>
  value
    .split(/\n/)
    .map(item => item.trim())
    .filter(Boolean);
const sources = (value: string) =>
  lines(value).map(line => {
    const parts = line.split('|').map(item => item.trim());
    return {
      label: parts.length > 1 ? parts[0] : parts[0],
      url: parts.length > 1 ? parts.slice(1).join('|') : parts[0],
    };
  });
function blankRecord(section: CatalogSection, payload: CatalogPayload): any {
  const reviewedAt = new Date().toISOString().slice(0, 10);
  const platformId = payload.platforms[0]?.id || '';
  if (section === 'identities')
    return {
      id: '',
      name: '',
      platformId,
      vendor: '',
      type: 'other',
      kind: 'http_crawler',
      uaSelector: '',
      family: '',
      parentId: null,
      aiEligible: false,
      status: 'pending',
      control: { remote: false, nginx: false },
      robotsToken: null,
      purpose: 'unknown',
      productForm: 'unknown',
      productIds: [],
      metadata: {
        id: '',
        name: '',
        vendor: '',
        aliases: [],
        purposes: [],
        kind: 'crawler',
        evidence: 'pending',
        summary: '',
        ua: '',
        token: '',
        feeds: [],
        verification: '',
        robots: '',
        advice: '',
        sources: [],
        reviewedAt,
      },
    };
  if (section === 'platforms')
    return { id: '', name: '', operator: '', region: 'global', website: '', documentationUrls: [] };
  if (section === 'products')
    return {
      id: '',
      name: '',
      platformId,
      aliases: [],
      form: 'unknown',
      supportStatus: 'pending',
      website: '',
      documentationUrls: [],
      identityIds: [],
      tags: [],
      notes: '',
    };
  if (section === 'referrals')
    return {
      id: '',
      platformId,
      productId: null,
      host: '',
      includeSubdomains: false,
      aliases: [],
      kind: 'ai',
      enabled: false,
      documentationUrls: [],
    };
  if (section === 'rangeSources')
    return {
      id: '',
      enabled: true,
      url: '',
      names: [],
      crawlerIds: [],
      parserVersion: 'prefixes-v1',
      browserExclusion: 'unsupported',
      reviewedAt,
    };
  return {
    id: '',
    enabled: true,
    crawlerIds: [],
    method: 'dns',
    documentationUrl: '',
    hostSuffixes: [],
  };
}
function RegistryClose({ busy }: { busy: boolean }) {
  const dialog = useDialog();
  const i18n = useLiekanI18n();
  return (
    <Button onClick={dialog?.requestClose} disabled={busy}>
      {i18n.text('关闭')}
    </Button>
  );
}
export function CrawlerRegistryRecord({
  section,
  record,
  payload,
  editable,
  busy,
  onSave,
  requestError,
  retryAction,
  onReload,
  onClose,
}: {
  section: CatalogSection;
  record?: any;
  payload: CatalogPayload;
  editable: boolean;
  busy: boolean;
  onSave: (payload: CatalogPayload) => Promise<boolean>;
  requestError?: string;
  retryAction?: () => Promise<boolean>;
  onReload?: () => Promise<void>;
  onClose: () => void;
}) {
  const i18n = useLiekanI18n();
  const formId = useId();
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const [value, setValue] = useState<any>(() =>
    structuredClone(record || blankRecord(section, payload)),
  );
  const [error, setError] = useState('');
  const [rawLists, setRawLists] = useState<Record<string, string>>({});
  const initialBaseline = record && payload.rangeBaselines[record.id];
  const [baselinePrefixes, setBaselinePrefixes] = useState(
    initialBaseline?.prefixes.join('\n') || '',
  );
  const [baselineObservedAt, setBaselineObservedAt] = useState(
    initialBaseline ? new Date(initialBaseline.observedAt).toISOString().slice(0, 16) : '',
  );
  const [baselineEdited, setBaselineEdited] = useState(false);
  const set = (key: string, next: any) => {
    if (key === 'url' && section === 'rangeSources' && next !== value.url) {
      setBaselinePrefixes('');
      setBaselineObservedAt('');
      setBaselineEdited(true);
    }
    setValue((old: any) => ({
      ...old,
      [key]: next,
      ...(key === 'crawlerIds' && section === 'rangeSources'
        ? {
            names: next.map(
              (id: string) => payload.identities.find(item => item.id === id)?.name || id,
            ),
          }
        : {}),
    }));
  };
  const meta = (key: string, next: any) =>
    setValue((old: any) => ({ ...old, metadata: { ...old.metadata, [key]: next } }));
  const input = (key: string, label: string, opts: any = {}) => (
    <Field
      key={key}
      label={i18n.system(label)}
      value={value[key] ?? ''}
      disabled={
        !editable ||
        busy ||
        (!!record &&
          (key === 'id' ||
            (section === 'identities' && ['uaSelector', 'family'].includes(key)) ||
            (section === 'referrals' && key === 'host')))
      }
      onChange={e => set(key, e.target.value || (opts.nullable ? null : ''))}
      {...Object.fromEntries(Object.entries(opts).filter(([key]) => key !== 'nullable'))}
    />
  );
  const select = (
    key: string,
    label: string,
    options: Record<string, string>,
    nullable = false,
  ) => (
    <Select
      key={key}
      label={i18n.system(label)}
      value={key === 'browserExclusion' ? value[key] || 'unsupported' : value[key] || ''}
      disabled={
        !editable ||
        busy ||
        (!!record && (key === 'platformId' || (section === 'identities' && key === 'kind')))
      }
      onChange={e => set(key, e.target.value || (nullable ? null : ''))}
      options={Object.entries(options).map(([id, text]) => [id, i18n.system(text)])}
    />
  );
  const list = (key: string, label: string, help = '每行一项') => (
    <Textarea
      key={key}
      label={i18n.system(label)}
      help={i18n.system(help)}
      rows={3}
      value={rawLists[key] ?? (value[key] || []).join('\n')}
      disabled={!editable || busy}
      onChange={e => {
        setRawLists(old => ({ ...old, [key]: e.target.value }));
        set(key, lines(e.target.value));
      }}
    />
  );
  const check = (key: string, label: string) => (
    <Check
      key={key}
      checked={!!value[key]}
      disabled={!editable || busy}
      onChange={e => set(key, e.target.checked)}
    >
      {i18n.system(label)}
    </Check>
  );
  const associations = (key: string, label: string, rows: { id: string; name: string }[]) => (
    <fieldset className="registry-checks" disabled={!editable || busy}>
      <legend>{i18n.system(label)}</legend>
      {rows.map(item => (
        <Check
          key={item.id}
          checked={(value[key] || []).includes(item.id)}
          onChange={e =>
            set(
              key,
              e.target.checked
                ? [...(value[key] || []), item.id]
                : value[key].filter((id: string) => id !== item.id),
            )
          }
        >
          {item.name}
        </Check>
      ))}
    </fieldset>
  );
  const platformOptions = Object.fromEntries(payload.platforms.map(item => [item.id, item.name]));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editable || busy) return;
    if (!record && payload[section].some(item => item.id === value.id)) {
      setError(i18n.text('稳定 ID 已存在，请使用新的 ID。'));
      return;
    }
    let next = value;
    if (section === 'identities')
      next = {
        ...value,
        family: value.family || value.id,
        uaSelector: value.kind === 'http_crawler' ? value.uaSelector : null,
        metadata: {
          ...value.metadata,
          id: value.id,
          name: value.name,
          vendor: value.vendor,
          token: value.kind === 'http_crawler' ? value.uaSelector : '',
          robotsToken: value.robotsToken || undefined,
          kind: value.kind === 'robots_purpose' ? 'control' : 'crawler',
        },
      };
    const candidate = updateCatalogRecord(payload, section, next);
    if (
      section === 'rangeSources' &&
      (value.enabled !== false || lines(baselinePrefixes).length || baselineObservedAt)
    ) {
      if (
        !lines(baselinePrefixes).length ||
        !baselineObservedAt ||
        !Number.isFinite(Date.parse(baselineObservedAt + 'Z'))
      ) {
        setError(i18n.text('请填写已审核的 CIDR 范围与实际观测时间。'));
        return;
      }
      candidate.rangeBaselines = {
        ...candidate.rangeBaselines,
        [value.id]: {
          source: value.url,
          observedAt:
            !baselineEdited && initialBaseline
              ? initialBaseline.observedAt
              : new Date(baselineObservedAt + 'Z').toISOString(),
          publishedAt: initialBaseline?.source === value.url ? initialBaseline.publishedAt : null,
          prefixes: lines(baselinePrefixes),
        },
      };
    } else if (section === 'rangeSources' && initialBaseline) {
      candidate.rangeBaselines = { ...candidate.rangeBaselines };
      delete candidate.rangeBaselines[value.id];
    }
    const parsed = catalogPayloadSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      );
      return;
    }
    setError('');
    if (await onSave(parsed.data)) onClose();
  };
  const sourceList = (key: 'feeds' | 'sources', label: string) => (
    <Textarea
      label={i18n.system(label)}
      help={i18n.text('每行填写资料名称 | HTTPS 地址')}
      rows={3}
      disabled={!editable || busy}
      value={
        rawLists[key] ??
        value.metadata[key].map((item: any) => `${item.label} | ${item.url}`).join('\n')
      }
      onChange={e => {
        setRawLists(old => ({ ...old, [key]: e.target.value }));
        meta(key, sources(e.target.value));
      }}
    />
  );
  return (
    <LiekanDialog
      size="wide"
      title={i18n.text(record ? '查看与编辑{v0}' : '新增{v0}', [
        i18n.system(sectionLabels[section]),
      ])}
      onClose={onClose}
    >
      {!editable && (
        <Notice>{i18n.text('当前为只读目录。系统管理员可在草稿中修改并预览发布。')}</Notice>
      )}
      {record && (
        <div className="registry-evidence">
          <Definition
            items={[
              [i18n.text('稳定 ID'), record.id],
              ...(record.metadata
                ? ([
                    [
                      i18n.text('证据状态'),
                      <Badge key="evidence">
                        {i18n.system(statusLabels[record.metadata.evidence])}
                      </Badge>,
                    ],
                    [i18n.text('核验说明'), record.metadata.verification],
                    [
                      i18n.text('远程控制'),
                      i18n.text(record.control.remote ? '已审核支持' : '未接入'),
                    ],
                  ] as [string, React.ReactNode][])
                : []),
            ]}
          />
          {(
            record.metadata?.sources ||
            (record.documentationUrls || []).map((url: string) => ({ label: url, url }))
          ).map((item: any) => (
            <p key={item.url}>
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                {item.label}
              </a>
            </p>
          ))}
        </div>
      )}
      <form
        id={formId}
        onSubmit={save}
        data-dirty-actions
        data-unsaved={dirty ? 'true' : 'false'}
        aria-busy={busy || undefined}
        onChange={() => setDirty(true)}
        onClickCapture={event => {
          if ((event.target as Element).closest('button[data-dirty-action="true"]')) setDirty(true);
        }}
      >
        <div className="registry-form">
          {input('id', '稳定 ID', {
            required: true,
            pattern: '[a-z0-9]+(-[a-z0-9]+)*',
            maxLength: 80,
            help: i18n.text('使用小写字母、数字与连字符；已有 ID 保持不变。'),
          })}
          {['identities', 'platforms', 'products'].includes(section) &&
            input('name', '名称', { required: true, maxLength: 160 })}
          {['identities', 'products', 'referrals'].includes(section) &&
            select('platformId', '所属平台', platformOptions)}
          {section === 'identities' && (
            <>
              {input('vendor', '运营主体', { required: true })}
              {select('kind', '身份种类', {
                http_crawler: statusLabels.http_crawler,
                robots_purpose: statusLabels.robots_purpose,
                signed_agent: statusLabels.signed_agent,
              })}
              {select('status', '状态', { active: '启用', pending: '待核实', inactive: '停用' })}
              {select('purpose', '用途', purposeLabels)}
              {select('productForm', '产品形态', formLabels)}
              {select('type', '兼容分类', typeLabels)}
              {value.kind === 'http_crawler' &&
                input('uaSelector', 'UA 匹配词', { required: true, maxLength: 160 })}
              {input('robotsToken', 'robots 词元', { nullable: true })}
              {input('family', '身份家族', { help: i18n.text('留空时使用稳定 ID。') })}
              {select(
                'parentId',
                '父身份',
                {
                  '': '无',
                  ...Object.fromEntries(
                    payload.identities
                      .filter(item => item.id !== value.id)
                      .map(item => [item.id, item.name]),
                  ),
                },
                true,
              )}
              {check('aiEligible', '纳入 AI 请求统计资格')}
              <Select
                label={i18n.text('证据状态')}
                value={value.metadata.evidence}
                disabled={!editable || busy}
                options={['operator', 'observed', 'pending', 'inactive'].map(key => [
                  key,
                  i18n.system(statusLabels[key]),
                ])}
                onChange={e => meta('evidence', e.target.value)}
              />
              <Field
                label={i18n.text('人工复核日期')}
                type="date"
                value={value.metadata.reviewedAt}
                disabled={!editable || busy}
                onChange={e => meta('reviewedAt', e.target.value)}
              />
              {['summary', 'ua', 'verification', 'robots', 'advice'].map((key, i) => (
                <Textarea
                  key={key}
                  label={i18n.system(['摘要', 'UA 示例', '核验说明', 'robots 说明', '管理建议'][i])}
                  rows={2}
                  value={value.metadata[key] || ''}
                  disabled={!editable || busy}
                  onChange={e => meta(key, e.target.value)}
                />
              ))}
              <Textarea
                label={i18n.text('身份别名')}
                help={i18n.text('每行一项')}
                rows={2}
                value={rawLists.aliases ?? value.metadata.aliases.join('\n')}
                disabled={!editable || busy}
                onChange={e => {
                  setRawLists(old => ({ ...old, aliases: e.target.value }));
                  meta('aliases', lines(e.target.value));
                }}
              />
              {sourceList('sources', '官方资料')}
              {sourceList('feeds', '范围资料链接')}
              <Notice>
                {i18n.text('新增身份的远程控制能力需单独审核；此表单保留既有能力白名单。')}
              </Notice>
              {associations(
                'productIds',
                '关联产品',
                payload.products.filter(item => item.platformId === value.platformId),
              )}
            </>
          )}
          {section === 'platforms' && (
            <>
              {input('operator', '运营主体', { required: true })}
              {select('region', '服务区域', { domestic: '国内', global: '全球' })}
              {input('website', '官方网站', { type: 'url', required: true })}
              {list('documentationUrls', '官方资料地址')}
            </>
          )}
          {section === 'products' && (
            <>
              {select('form', '产品形态', formLabels)}
              {select('supportStatus', '支持状态', {
                confirmed: '已确认',
                pending: '待核实',
                unsupported: '缺少识别能力',
                inactive: '停用',
              })}
              {input('website', '官方网站', { type: 'url', required: true })}
              {list('aliases', '产品别名')}
              {list('tags', '附加标签')}
              {list('documentationUrls', '官方资料地址')}
              {input('notes', '备注')}
              {associations(
                'identityIds',
                '关联身份',
                payload.identities.filter(item => item.platformId === value.platformId),
              )}
            </>
          )}
          {section === 'referrals' && (
            <>
              {select(
                'productId',
                '关联产品',
                {
                  '': '产品未细分',
                  ...Object.fromEntries(
                    payload.products
                      .filter(item => item.platformId === value.platformId)
                      .map(item => [item.id, item.name]),
                  ),
                },
                true,
              )}
              {input('host', '引荐主机', { required: true, placeholder: 'chat.example.com' })}
              {select('kind', '来源种类', {
                ai: 'AI 引荐',
                mixed: '混合产品来源',
                documentation: '文档来源',
              })}
              {check('includeSubdomains', '包含子域名')}
              {check('enabled', '启用引荐规则')}
              {list('aliases', '来源别名')}
              {list('documentationUrls', '官方资料地址')}
            </>
          )}
          {section === 'rangeSources' && (
            <>
              <Check
                checked={value.enabled !== false}
                disabled={!editable || busy}
                onChange={e => set('enabled', e.target.checked)}
              >
                {i18n.text('启用范围来源')}
              </Check>
              {input('url', '范围来源地址', { required: true, type: 'url' })}
              <p className="field-help">{i18n.text('来源名称随所选身份自动填写。')}</p>
              {select('parserVersion', '解析格式', {
                'prefixes-v1': '标准 IP 前缀 JSON',
                'amazon-code-json-v1': 'Amazon Code JSON',
                'manual-reviewed-v1': '人工审核范围基准',
              })}
              {select('browserExclusion', '浏览统计排除用途', {
                unsupported: '未核实专用爬虫范围',
                dedicated_crawler: '已核实官方专用爬虫范围',
              })}
              <p className="field-help">
                {i18n.text(
                  '仅将官方确认的专用爬虫范围用于浏览统计过滤，共享云、代理和用户出口范围保持未核实。',
                )}
              </p>
              {input('reviewedAt', '人工复核日期', { type: 'date', required: true })}
              <Textarea
                label={i18n.text('已审核 CIDR 范围')}
                aria-label={i18n.text('已审核 CIDR 范围')}
                help={i18n.text('每行一个公开 CIDR 范围，仅填写已核对的官方数据。')}
                rows={5}
                value={baselinePrefixes}
                required={value.enabled !== false}
                disabled={!editable || busy}
                onChange={e => {
                  setBaselinePrefixes(e.target.value);
                  setBaselineEdited(true);
                }}
              />
              <Field
                label={i18n.text('实际观测时间（UTC）')}
                type="datetime-local"
                value={baselineObservedAt}
                required={value.enabled !== false}
                disabled={!editable || busy}
                onChange={e => {
                  setBaselineObservedAt(e.target.value);
                  setBaselineEdited(true);
                }}
              />
              {value.parserVersion === 'manual-reviewed-v1' && (
                <Notice>
                  {i18n.text('人工审核来源不会自动抓取或续期；更新范围时需记录新的实际观测时间。')}
                </Notice>
              )}

              {associations(
                'crawlerIds',
                '适用身份',
                payload.identities.filter(item => item.kind === 'http_crawler'),
              )}
            </>
          )}
          {section === 'verificationMethods' && (
            <>
              <Check
                checked={value.enabled !== false}
                disabled={!editable || busy}
                onChange={e => set('enabled', e.target.checked)}
              >
                {i18n.text('启用核验方法')}
              </Check>
              {select('method', '核验方法', {
                dns: 'DNS 核验',
                signature: '签名资料',
                edge: '可信边缘核验',
              })}
              {input('documentationUrl', '官方说明地址', { required: true, type: 'url' })}
              {value.method === 'dns' && list('hostSuffixes', '官方 DNS 后缀')}
              {value.method === 'signature' && (
                <>
                  {input('signatureAgent', 'Signature-Agent 地址', { type: 'url' })}
                  {input('keyDirectory', '密钥目录地址', { type: 'url' })}
                </>
              )}
              {value.method === 'edge' && (
                <>
                  {input('provider', '边缘服务商')}
                  <Textarea
                    label={i18n.text('检测 ID')}
                    help={i18n.text('每行一个非负整数')}
                    rows={3}
                    value={rawLists.detectionIds ?? (value.detectionIds || []).join('\n')}
                    disabled={!editable || busy}
                    onChange={e => {
                      setRawLists(old => ({ ...old, detectionIds: e.target.value }));
                      set('detectionIds', lines(e.target.value).map(Number));
                    }}
                  />
                </>
              )}
              {associations('crawlerIds', '适用身份', payload.identities)}
              <Notice>
                {i18n.text('签名资料用于记录官方方法；请求核验需要可信输入与已接入的核验能力。')}
              </Notice>
            </>
          )}
        </div>
        {error && (
          <Notice tone="red">
            <p>{i18n.text('请检查字段格式与关联关系。')}</p>
            <pre className="registry-error">{error}</pre>
          </Notice>
        )}
      </form>
      {requestError && (
        <Notice tone="red">
          {i18n.system(requestError)}
          {retryAction && (
            <Button disabled={busy} onClick={retryAction}>
              {i18n.text('重试同一操作')}
            </Button>
          )}
          {onReload && (
            <Button disabled={busy} onClick={onReload}>
              {i18n.text('重新读取最新版本')}
            </Button>
          )}
        </Notice>
      )}
      <DialogActions>
        <RegistryClose busy={busy} />
        {editable && (
          <Button type="submit" form={formId} primary disabled={busy}>
            {i18n.text(busy ? '正在保存' : '保存到草稿')}
          </Button>
        )}
      </DialogActions>
    </LiekanDialog>
  );
}
