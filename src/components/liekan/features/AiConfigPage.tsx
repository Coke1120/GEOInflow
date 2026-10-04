'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  type AiCatalog,
  type AiConnection,
  type AiConnectionListItem,
  aiClient,
} from '@/lib/liekan/upstream/ai-client';
import {
  AiButton,
  AiCatalogMore,
  AiModal,
  AiNotice,
  type AiSpaceOption,
  aiError,
  ModelWindow,
  ModuleNotice,
  RunMetrics,
  RunStatus,
  record,
  styles,
  useAiCatalog,
  useAiRun,
} from './AiShared';
import { useFeature } from './context';
export function AiConfigPage() {
  const c = useFeature(),
    catalog = useAiCatalog(),
    client = useQueryClient();
  const [spaceId, setSpaceId] = useState(''),
    [form, setForm] = useState<AiConnectionListItem | true | null>(null),
    [test, setTest] = useState<AiConnectionListItem | null>(null),
    [deleting, setDeleting] = useState<AiConnectionListItem | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [actionSpace, setActionSpace] = useState('');
  const data = catalog.data;
  const requestedSite = data?.websites.find(s => s.id === c.query.aiSite);
  const space = data?.spaces.find(
    s =>
      `${s.kind}:${s.id}` ===
      (spaceId ||
        (requestedSite
          ? `${requestedSite.space.kind}:${requestedSite.space.id}`
          : `personal:${c.user.id}`)),
  );
  const spaceKey = space ? `${space.kind}:${space.id}` : '';
  useEffect(() => {
    setForm(null);
    setTest(null);
    setDeleting(null);
    setError('');
    setActionSpace('');
  }, [spaceKey]);
  const selectAction = (select: () => void) => {
    setActionSpace(spaceKey);
    select();
  };
  const list = useQuery({
    queryKey: ['liekan-ai', c.user.id, 'connections', space?.kind, space?.id],
    queryFn: ({ signal }) => aiClient.connections(space, signal),
    enabled: !!space && !!data?.module.enabled,
    retry: false,
  });
  const rows = list.data?.items || [];
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['liekan-ai', c.user.id, 'connections'] });
  const action = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
      c.notify(message);
    } catch (e) {
      setError(aiError(e));
      if (record(e).status === 409) await refresh();
    } finally {
      setBusy(false);
    }
  };
  if (catalog.isPending)
    return (
      <div data-liekan-ai="ai-config" className={styles.workspace}>
        <AiNotice>正在读取 AI 能力与空间权限…</AiNotice>
      </div>
    );
  if (catalog.error && !catalog.data)
    return (
      <div data-liekan-ai="ai-config" className={styles.workspace}>
        <AiNotice error>{aiError(catalog.error)}</AiNotice>
        <AiButton onClick={() => void catalog.refetch()}>重新读取</AiButton>
      </div>
    );
  if (!data) return null;
  return (
    <div data-liekan-ai="ai-config" className={styles.workspace} lang="zh-CN">
      <ModuleNotice catalog={data} />
      <AiCatalogMore query={catalog} />
      {error && <AiNotice error>{error}</AiNotice>}
      {form && space && actionSpace === spaceKey ? (
        <ConnectionForm
          key={`${spaceKey}:${form === true ? 'new' : form.id}`}
          catalog={data}
          space={space}
          existing={form === true ? undefined : form}
          onConflict={refresh}
          onClose={() => setForm(null)}
          onSave={async () => {
            setForm(null);
            await refresh();
            c.notify('API 配置已保存，请实时测试当前配置。');
          }}
        />
      ) : (
        <>
          <div className={styles.pageHeading}>
            <div>
              <h2>AI配置器</h2>
              <p>管理模型 API，为网站分析选择可用连接。</p>
            </div>
            <AiButton
              primary
              disabled={
                !data.module.enabled ||
                !space?.canManage ||
                rows.length >= data.limits.connectionsPerSpace
              }
              onClick={() => selectAction(() => setForm(true))}
            >
              新建 API
            </AiButton>
          </div>
          <div className={styles.scope}>
            <label>
              所属空间
              <select
                aria-label="AI 所属空间"
                value={space ? `${space.kind}:${space.id}` : ''}
                onChange={e => {
                  setSpaceId(e.target.value);
                  setError('');
                }}
              >
                {!space && <option value="">请选择空间</option>}
                {data.spaces.map(s => (
                  <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                    {s.name}
                    {s.kind === 'team' ? ' · 团队' : ' · 个人'}
                  </option>
                ))}
              </select>
            </label>
            <span className={styles.badge}>
              {rows.length} / {data.limits.connectionsPerSpace} 个连接
            </span>
          </div>
          {!space?.canManage && (
            <AiNotice>
              {space?.canUse
                ? '你可以使用已验证的连接。请联系空间管理员管理 API。'
                : '当前空间为只读权限，无法执行实时测试与 AI 分析。'}
            </AiNotice>
          )}
          {list.error ? (
            <>
              <AiNotice error>{aiError(list.error)}</AiNotice>
              <AiButton onClick={() => void list.refetch()}>重新读取连接</AiButton>
            </>
          ) : list.isLoading ? (
            <AiNotice>正在读取 API 连接…</AiNotice>
          ) : (
            data.module.enabled && (
              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h3>API 列表</h3>
                    <p>密钥只显示是否已配置。实时测试会向供应商发送短文本请求。</p>
                  </div>
                  <AiButton onClick={() => void list.refetch()}>刷新列表</AiButton>
                </div>
                {!rows.length ? (
                  <div className={styles.empty}>
                    <h3>添加你的第一个模型 API</h3>
                    <p>选择平台并填写 API Key，其他参数由模板自动填写。</p>
                    {space?.canManage && (
                      <AiButton primary onClick={() => selectAction(() => setForm(true))}>
                        添加 API
                      </AiButton>
                    )}
                  </div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.apiList}>
                      <thead>
                        <tr>
                          <th>连接名称</th>
                          <th>模型与接口</th>
                          <th>连接状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => (
                          <tr key={row.id}>
                            <td>
                              <div className={styles.apiName}>
                                <span className={styles.providerMark}>
                                  {data.templates
                                    .find(t => t.provider === row.provider)
                                    ?.name.slice(0, 2) || 'API'}
                                </span>
                                <div>
                                  <strong>{row.name}</strong>
                                  <small>
                                    {data.templates.find(t => t.provider === row.provider)?.name ||
                                      row.provider}
                                    {row.isDefault ? ' · 默认分析模型' : ''}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <strong className={styles.model}>{row.model}</strong>
                              <span className={styles.endpoint}>{row.baseUrl}</span>
                              <small>
                                地域：
                                {typeof record(row).region === 'string' && record(row).region
                                  ? String(record(row).region)
                                  : '未知'}
                              </small>
                              <small>
                                应用上下文窗口：
                                <ModelWindow catalog={data} configuration={row} />
                              </small>
                              <small>
                                {row.protocol === 'anthropic-messages'
                                  ? 'Anthropic Messages'
                                  : 'OpenAI Chat Completions'}
                              </small>
                            </td>
                            <td>
                              <span
                                className={`${styles.badge} ${row.testState === 'connected' ? styles.success : ''}`}
                              >
                                {!row.enabled
                                  ? '已停用'
                                  : {
                                      untested: '尚未测试',
                                      testing: '测试中',
                                      connected: '已连通',
                                      failed: '测试失败',
                                    }[row.testState]}
                              </span>
                              <small>{row.hasKey ? '密钥已配置' : '缺少密钥'}</small>
                              <small>
                                {row.testedAt
                                  ? new Date(row.testedAt).toLocaleString('zh-CN', {
                                      timeZone: c.range.timezone,
                                    })
                                  : '尚无测试记录'}
                              </small>
                              {space?.canManage && row.lastCall && (
                                <details>
                                  <summary>最近调用</summary>
                                  <span className={styles.endpoint}>
                                    {lastCallText(row.lastCall, c.range.timezone)}
                                  </span>
                                </details>
                              )}
                            </td>
                            <td>
                              <div className={styles.rowActions}>
                                <AiButton
                                  disabled={
                                    busy || !space?.canManage || !space?.canUse || !row.enabled
                                  }
                                  onClick={() => selectAction(() => setTest({ ...row }))}
                                >
                                  实时测试
                                </AiButton>
                                {space?.canManage && (
                                  <>
                                    <AiButton
                                      disabled={busy}
                                      onClick={() => selectAction(() => setForm(row))}
                                    >
                                      编辑
                                    </AiButton>
                                    <AiButton
                                      disabled={busy}
                                      onClick={() =>
                                        void action(
                                          () =>
                                            aiClient.updateConnection(
                                              updatePayload(row, { enabled: !row.enabled }),
                                            ),
                                          row.enabled ? '连接已停用。' : '连接已启用。',
                                        )
                                      }
                                    >
                                      {row.enabled ? '停用' : '启用'}
                                    </AiButton>
                                    <AiButton
                                      disabled={
                                        busy ||
                                        row.isDefault ||
                                        !row.enabled ||
                                        row.testState !== 'connected' ||
                                        row.capabilities.keyVerified.text !== true
                                      }
                                      onClick={() =>
                                        void action(
                                          () =>
                                            aiClient.updateConnection(
                                              updatePayload(row, { isDefault: true }),
                                            ),
                                          '默认分析模型已更新。',
                                        )
                                      }
                                    >
                                      设为默认
                                    </AiButton>
                                    <AiButton
                                      disabled={busy}
                                      onClick={() => selectAction(() => setDeleting(row))}
                                    >
                                      删除
                                    </AiButton>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className={styles.listFooter}>
                  修改接口、模型或密钥后，请重新测试，再设为默认分析模型。
                </div>
              </section>
            )
          )}
          <div className={styles.bottom}>
            <div>
              <h3>从配置到分析</h3>
              <p>新建 API → 实时测试 → 设为默认。网站使用其所属个人或团队空间中的连接。</p>
            </div>
            <div>
              <h3>密钥与调用</h3>
              <p>
                密钥由服务端加密保存，页面无法读取原值。测试与分析可能产生供应商费用，用量以实际返回为准。
              </p>
            </div>
          </div>
        </>
      )}
      {test && actionSpace === spaceKey && (
        <ConnectionTest
          key={test.id}
          connection={test}
          catalog={data}
          onClose={() => setTest(current => (current === test ? null : current))}
          onFinished={() => void refresh()}
        />
      )}
      {deleting && actionSpace === spaceKey && (
        <AiModal
          title="删除 API 连接"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <div className={styles.modalBody}>
            <p>确认删除「{deleting.name}」？依赖这条连接的新分析将不可用。</p>
            {error && <AiNotice error>{error}</AiNotice>}
          </div>
          <div className={styles.modalFooter}>
            <AiButton disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </AiButton>
            <AiButton
              primary
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await aiClient.deleteConnection(deleting.id, deleting.rowVersion);
                  setDeleting(null);
                }, 'API 连接已删除。')
              }
            >
              删除连接
            </AiButton>
          </div>
        </AiModal>
      )}
    </div>
  );
}
function lastCallText(input: unknown, timezone: string) {
  const v = record(input);
  const states: Record<string, string> = {
    accepted: '请求已接受',
    preparing: '准备中',
    calling: '调用中',
    validating: '校验中',
    completed: '已完成',
    failed: '未完成',
    cancelled: '已取消',
    cancel_requested: '等待取消',
    interrupted: '已中断',
    invalidated: '结果已失效',
  };
  const timestamp = (value: unknown) => {
    if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) return '未知';
    return new Date(value).toLocaleString('zh-CN', { timeZone: timezone, hour12: false });
  };
  return [
    v.operation === 'test' ? '连接测试' : v.operation === 'analysis' ? '网站分析' : '调用类型未知',
    states[String(v.state)] || '状态未知',
    `开始 ${timestamp(v.createdAt)}`,
    `结束 ${timestamp(v.completedAt)}`,
    ...(v.errorCode ? [aiError({ code: v.errorCode })] : []),
  ].join(' · ');
}
function updatePayload(row: AiConnection, patch: Partial<AiConnection> = {}) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    model: row.model,
    workspaceId: row.workspaceId,
    enabled: row.enabled,
    isDefault: row.isDefault,
    rowVersion: row.rowVersion,
    ...patch,
  };
}
type FormValues = {
  provider: AiConnection['provider'];
  protocol: AiConnection['protocol'];
  name: string;
  baseUrl: string;
  model: string;
  workspaceId: string;
  apiKey: string;
};
function ConnectionForm({
  catalog,
  space,
  existing,
  onClose,
  onSave,
  onConflict,
}: {
  catalog: AiCatalog;
  space: AiSpaceOption;
  existing?: AiConnection;
  onClose: () => void;
  onSave: () => Promise<void>;
  onConflict: () => Promise<unknown>;
}) {
  const first = catalog.templates.find(t => t.id === 'deepseek') || catalog.templates[0];
  const [values, setValues] = useState<FormValues>(() =>
    existing
      ? {
          provider: existing.provider,
          protocol: existing.protocol,
          name: existing.name,
          baseUrl: existing.baseUrl,
          model: existing.model,
          workspaceId: existing.workspaceId || '',
          apiKey: '',
        }
      : {
          provider: first.provider as AiConnection['provider'],
          protocol: first.protocol as AiConnection['protocol'],
          name: first.name,
          baseUrl: first.baseUrl,
          model: first.model,
          workspaceId: '',
          apiKey: '',
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [advanced, setAdvanced] = useState(!values.baseUrl || !values.model);
  const active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  const preset = catalog.templates.find(t => t.provider === values.provider);
  const edit = (field: keyof FormValues, value: string) => {
    setValues(v => ({ ...v, [field]: value }));
    setErrors(e => ({ ...e, [field]: '' }));
  };
  const newKey =
    !!existing &&
    (origin(values.baseUrl) !== origin(existing.baseUrl) ||
      values.protocol !== existing.protocol ||
      values.provider !== existing.provider ||
      (values.provider === 'anthropic' ? values.workspaceId || null : null) !==
        (existing.workspaceId || null));
  const choose = (id: string) => {
    const t = catalog.templates.find(t => t.id === id);
    if (!t) return;
    setValues({
      provider: t.provider as AiConnection['provider'],
      protocol: t.protocol as AiConnection['protocol'],
      name: t.name,
      baseUrl: t.baseUrl,
      model: t.model,
      workspaceId: '',
      apiKey: '',
    });
    setAdvanced(t.id === 'custom');
    setErrors({});
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !space.canManage || !catalog.module.enabled) return;
    const validation: Record<string, string> = {};
    if (!values.name.trim() || values.name.trim().length > 100)
      validation.name = '请填写 1 至 100 字的连接名称。';
    try {
      const url = new URL(values.baseUrl);
      if (
        url.protocol !== 'https:' ||
        (url.port && url.port !== '443') ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.hostname === 'localhost' ||
        !url.hostname.includes('.') ||
        /\s/.test(values.baseUrl)
      )
        throw new Error();
    } catch {
      validation.baseUrl = '请填写公共 HTTPS 443 接口地址，不含账号、查询参数或片段。';
    }
    if (!values.model || values.model.length > 200 || /[\s\p{Cc}]/u.test(values.model))
      validation.model = '请填写有效的模型标识。';
    if ((!existing || newKey) && !values.apiKey) validation.apiKey = '请填写当前接口的 API Key。';
    if (
      values.apiKey &&
      (new TextEncoder().encode(values.apiKey).byteLength > 4096 || /\p{Cc}/u.test(values.apiKey))
    )
      validation.apiKey = 'API Key 格式或长度无效。';
    if (values.workspaceId && !/^wrkspc_[A-Za-z0-9_-]{1,93}$/.test(values.workspaceId))
      validation.workspaceId = '工作空间标识需要以 wrkspc_ 开头。';
    setErrors(validation);
    if (Object.keys(validation).length) {
      setAdvanced(true);
      return;
    }
    setBusy(true);
    setError('');
    const templated =
      preset &&
      values.provider === preset.provider &&
      values.protocol === preset.protocol &&
      values.baseUrl === preset.baseUrl &&
      values.model === preset.model;
    const payload = {
      name: values.name.trim(),
      provider: values.provider,
      protocol: values.protocol,
      baseUrl: values.baseUrl,
      model: values.model,
      workspaceId:
        values.provider === 'anthropic' && values.workspaceId ? values.workspaceId : null,
      ...(templated ? { templateId: preset.id as AiConnection['provider'] } : {}),
      ...(values.apiKey ? { apiKey: values.apiKey } : {}),
      enabled: existing?.enabled ?? true,
      isDefault: false,
    };
    try {
      if (existing)
        await aiClient.updateConnection({
          id: existing.id,
          rowVersion: existing.rowVersion,
          ...payload,
        });
      else
        await aiClient.createConnection({
          ...payload,
          apiKey: values.apiKey,
          space: { kind: space.kind, id: space.id },
        });
      if (active.current) await onSave();
    } catch (e) {
      if (active.current) setError(aiError(e));
      if (record(e).status === 409) await onConflict();
    } finally {
      if (active.current) {
        setValues(v => ({ ...v, apiKey: '' }));
        setBusy(false);
      }
    }
  };
  const field = (name: keyof FormValues, label: string, type = 'text', help?: string) => (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        aria-label={label}
        type={type}
        value={values[name]}
        maxLength={
          name === 'apiKey' ? 4096 : name === 'baseUrl' ? 2048 : name === 'name' ? 100 : 200
        }
        autoComplete={name === 'apiKey' ? 'new-password' : 'off'}
        spellCheck={false}
        onChange={e => edit(name, e.target.value)}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `ai-${name}-error` : undefined}
      />
      {help && <small>{help}</small>}
      {errors[name] && (
        <span id={`ai-${name}-error`} className={styles.fieldError}>
          {errors[name]}
        </span>
      )}
    </label>
  );
  return (
    <form onSubmit={submit} className={styles.configForm}>
      <div className={styles.pageHeading}>
        <div>
          <h2>{existing ? '编辑 API' : '新建 API'}</h2>
          <p>所属空间：{space.name}。选择平台后，只需填写 API Key。</p>
        </div>
        <AiButton
          onClick={() => {
            setValues(v => ({ ...v, apiKey: '' }));
            onClose();
          }}
        >
          返回 API 列表
        </AiButton>
      </div>
      <h3>选择模型平台</h3>
      <div className={styles.providerGrid}>
        {catalog.templates.map(t => (
          <label
            key={t.id}
            className={`${styles.providerCard} ${values.provider === t.provider ? styles.selectedProvider : ''}`}
          >
            <input
              type="radio"
              name="ai-provider"
              value={t.id}
              checked={values.provider === t.provider}
              onChange={() => choose(t.id)}
            />
            <span className={styles.providerMark}>{t.name.slice(0, 2)}</span>
            <span>
              <strong>{t.name}</strong>
              <small>{t.id === 'custom' ? '自定义参数' : '官方直连接口'}</small>
            </span>
          </label>
        ))}
      </div>
      <div className={styles.formLayout}>
        <section className={styles.panel}>
          <div className={styles.panelBody}>
            {field('name', '连接名称')}
            {field(
              'apiKey',
              'API Key',
              'password',
              existing
                ? newKey
                  ? '连接身份已变更，请重新填写 API Key。提交后输入框会清空。'
                  : '留空保留已有密钥。提交后输入框会清空。'
                : '密钥为只写字段，保存后无法读取原值。',
            )}
            {newKey && (
              <AiNotice>供应商、协议、工作空间或接口域名已变更，请重新填写 API Key。</AiNotice>
            )}
            <dl className={styles.summary}>
              <dt>模型</dt>
              <dd>{values.model || '请填写模型标识'}</dd>
              <dt>地址</dt>
              <dd>{values.baseUrl || '请填写 API 地址'}</dd>
              <dt>应用上下文窗口</dt>
              <dd>
                <ModelWindow catalog={catalog} configuration={values} />
              </dd>
              <dt>协议</dt>
              <dd>
                {values.protocol === 'anthropic-messages'
                  ? 'Anthropic Messages'
                  : 'OpenAI Chat Completions'}
              </dd>
            </dl>
            <details open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}>
              <summary>高级配置</summary>
              {field('baseUrl', 'API 地址')}
              {field('model', '模型标识')}
              <label className={styles.field}>
                <span>协议</span>
                <select aria-label="协议" value={values.protocol} disabled>
                  <option value="openai-chat">OpenAI Chat Completions</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                </select>
                <small>协议由所选平台确定。</small>
              </label>
              {values.provider === 'anthropic' &&
                field(
                  'workspaceId',
                  'Claude 工作空间标识',
                  'text',
                  '普通 Key 可留空；多空间 Key 填写 wrkspc_ 标识。',
                )}
            </details>
            {existing && <AiNotice>保存配置将清除默认状态，请重新测试当前配置。</AiNotice>}
            {error && <AiNotice error>{error}</AiNotice>}
          </div>
          <div className={styles.modalFooter}>
            <AiButton
              onClick={() => {
                setValues(v => ({ ...v, apiKey: '' }));
                onClose();
              }}
            >
              取消
            </AiButton>
            <AiButton primary type="submit" disabled={busy}>
              {busy ? '正在保存…' : '保存 API'}
            </AiButton>
          </div>
        </section>
        <aside className={styles.formNote}>
          <h3>接入说明</h3>
          {preset?.notes.map(note => (
            <p key={note}>{note}</p>
          ))}
          {preset?.documentationUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              {i === 0 ? '查看官方文档' : '查看模型文档'}
            </a>
          ))}
          <p>Key 与接口需要来自同一平台和地域。连通性与模型权限以实时测试为准。</p>
          <p>只支持文本分析。连接测试与分析可能产生供应商费用。</p>
        </aside>
      </div>
    </form>
  );
}
function origin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
function ConnectionTest({
  connection,
  catalog,
  onClose,
  onFinished,
}: {
  connection: AiConnection;
  catalog: AiCatalog;
  onClose: () => void;
  onFinished: () => void;
}) {
  const c = useFeature(),
    task = useAiRun(`liekan-ai:${c.user.id}:test:${connection.id}`, onFinished),
    started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      if (!task.metadata)
        void task.start(`/liekan/ai/connections/${connection.id}/test`, {
          expectedConfigVersion: connection.configVersion,
        });
    }
  }, []);
  const close = async () => {
    if (await task.stop()) onClose();
  };
  const result = record(task.run?.result),
    providerResponse = record(result.providerResponse),
    valid = task.run?.state === 'completed' && typeof result.text === 'string';
  const phases = [
    { label: '配置检查', stages: ['accepted', 'preparing'] },
    { label: '发送请求', stages: ['calling'] },
    { label: '首次文本', stages: ['first_text'] },
    { label: '接收完成', stages: ['validating', 'completed'] },
  ];
  const currentPhase = phases.findIndex(p => p.stages.includes(task.stage));
  const responseStatus =
    typeof providerResponse.status === 'number' &&
    Number.isInteger(providerResponse.status) &&
    providerResponse.status >= 100 &&
    providerResponse.status <= 599
      ? providerResponse.status
      : '未知';
  const responseRequestId =
    typeof providerResponse.requestId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(providerResponse.requestId)
      ? providerResponse.requestId
      : '未知';
  return (
    <AiModal
      title="实时测试"
      subtitle={`${connection.name} · ${connection.model}`}
      onClose={close}
      wide
    >
      <div className={styles.testBanner}>
        <RunStatus state={task.stage} />
        <span>当前配置版本 {connection.configVersion} · 真实文本测试，可能产生费用</span>
      </div>
      <div className={styles.testGrid}>
        <aside className={styles.testSidebar}>
          <h3>连接检查</h3>
          <ol className={styles.stages} aria-label="连接检查阶段">
            {phases.map((phase, i) => (
              <li key={phase.label} className={currentPhase === i ? styles.currentStage : ''}>
                <span>{i + 1}</span>
                <div>
                  <strong>{phase.label}</strong>
                  <small>
                    {task.run?.state === 'completed'
                      ? '已完成'
                      : currentPhase === i
                        ? '正在执行'
                        : currentPhase > i
                          ? '已完成'
                          : '等待'}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          <RunMetrics run={task.run} />
        </aside>
        <div className={styles.testOutput}>
          <h3>请求摘要</h3>
          <dl className={styles.summary}>
            <dt>模型</dt>
            <dd>{connection.model}</dd>
            <dt>地址</dt>
            <dd>{connection.baseUrl}</dd>
            <dt>协议</dt>
            <dd>{connection.protocol}</dd>
            <dt>应用上下文窗口</dt>
            <dd>
              <ModelWindow catalog={catalog} configuration={connection} />
            </dd>
            <dt>认证</dt>
            <dd>已配置密钥，原值不可读取</dd>
            <dt>{task.run?.id || task.metadata?.runId ? '任务 ID' : '请求 ID'}</dt>
            <dd>
              {task.run?.id ||
                task.metadata?.runId ||
                task.metadata?.clientRequestId ||
                '等待接受请求'}
            </dd>
            <dt>供应商状态码</dt>
            <dd>{responseStatus}</dd>
            <dt>供应商请求 ID</dt>
            <dd>{responseRequestId}</dd>
          </dl>
          <h3>{valid ? '已校验的真实返回' : '实时预览 · 尚未校验'}</h3>
          <p className={styles.testPrompt}>测试提问：请回复 LIEKAN_OK，连接成功。</p>
          <div className={styles.testAnswer}>
            {valid ? String(result.text) : task.preview || '等待模型返回…'}
          </div>
          <h3 className={styles.testLogHeading}>测试事件记录</h3>
          <ol className={styles.testLog} aria-label="测试事件记录">
            {task.eventLogs.map((event, i) => (
              <li key={`${event.timestamp}:${i}`} data-ai-event-stage={event.stage}>
                <time dateTime={event.timestamp}>
                  {new Date(event.timestamp).toLocaleTimeString('zh-CN', {
                    timeZone: c.range.timezone,
                    hour12: false,
                  })}
                </time>
                <span>{event.label}</span>
              </li>
            ))}
          </ol>
          <p className={styles.muted}>记录仅保留当前页面的阶段与时间，关闭后清空。</p>
          {task.error && <AiNotice error>{task.error}</AiNotice>}
          {task.run?.error && <AiNotice error>{aiError(task.run.error)}</AiNotice>}
        </div>
      </div>
      <div className={styles.modalFooter}>
        <span>首字耗时由实际响应计算。非流式响应显示不适用，用量缺失显示未知。</span>
        {task.busy && <AiButton onClick={() => void task.stop()}>停止测试</AiButton>}
        {task.recoverable && (
          <AiButton disabled={task.busy} onClick={() => void task.recover()}>
            回查原任务
          </AiButton>
        )}
        <AiButton onClick={() => void close()}>关闭</AiButton>
        {!task.busy && !task.recoverable && (
          <AiButton
            primary
            onClick={() => {
              task.reset();
              void task.start(`/liekan/ai/connections/${connection.id}/test`, {
                expectedConfigVersion: connection.configVersion,
              });
            }}
          >
            重新测试，发起新调用
          </AiButton>
        )}
      </div>
    </AiModal>
  );
}
