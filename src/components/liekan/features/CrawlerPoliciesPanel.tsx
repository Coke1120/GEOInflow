'use client';
import { TableCell } from './ui';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { useTaskPolling } from '@/lib/liekan/contracts/manual-refresh';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type {
  CrawlerPolicy,
  CrawlerConnection,
  CrawlerDeployment,
  CrawlerPolicyInput,
} from '@/lib/liekan/contracts/crawlers';
import {
  crawlerPolicyInputSchema,
  crawlerConnectionInputSchema,
} from '@/lib/liekan/contracts/crawlers';
import { crawlerDirectory } from '@/lib/liekan/crawlers/directory';
import { featureRequest } from '@/lib/liekan/upstream/features-client';
import { Button, Definition, Field, Notice, Select, Table } from './ui';
type Permissions = { canDraft: boolean; canControl: boolean; isAdmin?: boolean };
type List = {
  policies: CrawlerPolicy[];
  connections: CrawlerConnection[];
  deployments: CrawlerDeployment[];
  permissions: Permissions;
  controlPaused: boolean;
};
type Preview = {
  mode?: 'apply' | 'adopt';
  transfer?: {
    previous: {
      connectionId: string;
      generation: number;
      ownerUserId: string | null;
      teamId: string | null;
    };
    next: {
      connectionId: string;
      generation: number;
      ownerUserId: string | null;
      teamId: string | null;
    };
  } | null;
  id: string;
  expiresAt: string;
  operation: 'deploy' | 'stop' | 'rollback' | 'cleanup';
  policyId: string;
  policyVersion: number;
  hostname: string;
  paths: unknown;
  expression: string | null;
  before: unknown;
  after: unknown;
  impact: {
    searchBots: string[];
    fullSite: boolean;
    historicalRequests7d: {
      requests: number | null;
      unclassified: number;
      observedRequests: number;
      state: 'missing' | 'partial' | 'available';
      basis: 'historical_estimate';
      windowDays: 7;
    };
    otherRules: string;
    acknowledgement: string;
  };
  capabilities: Record<string, unknown>;
  limitations: string[];
  localOnly: boolean;
};
const states = {
  draft: '草稿',
  enabled: '已启用',
  stopped: '已停用',
  active: '可用',
  frozen: '已冻结',
  disconnected: '已断开',
  cleanup: '待清理',
  queued: '排队中',
  running: '执行中',
  confirmed: '配置回读一致',
  unknown: '结果待确认',
  failed: '失败',
  conflict: '远端冲突',
};
const fresh = (): CrawlerPolicyInput => ({
  name: '',
  botIds: ['gptbot'],
  paths: [{ value: '/docs', match: 'prefix' }],
  action: 'observe',
  expectedAccess: 'allow',
});
export function CrawlerPoliciesPanel({
  websiteId,
  permissions,
}: {
  websiteId: string;
  permissions: Permissions;
}) {
  const i18n = useLiekanI18n();
  const base = `/liekan/websites/${websiteId}`;
  const [list, setList] = useState<List | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const [zoneId, setZoneId] = useState(''),
    [token, setToken] = useState(''),
    [editing, setEditing] = useState<CrawlerPolicy | null>(null),
    [draft, setDraft] = useState(fresh),
    [pathText, setPathText] = useState('/docs'),
    [match, setMatch] = useState<'exact' | 'prefix'>('prefix'),
    [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<CrawlerPolicy | null>(null),
    [versions, setVersions] = useState<{ version: number; body: CrawlerPolicyInput }[]>([]),
    [targetVersion, setTargetVersion] = useState(''),
    [contextCurrent, setContextCurrent] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null),
    [acknowledged, setAcknowledged] = useState(false),
    [confirmed, setConfirmed] = useState<CrawlerDeployment | null>(null),
    [resolveAck, setResolveAck] = useState(false),
    [handoffAck, setHandoffAck] = useState(false);
  const operationId = useRef<string | null>(null),
    live = useRef(true);
  const rights = list?.permissions || permissions;
  const canDraft = rights.canDraft,
    canControl = rights.canControl;
  const read = async (signal?: AbortSignal) => {
    const result = await featureRequest<List>('GET', `${base}/crawler-policies`, undefined, signal);
    if (!signal?.aborted && live.current) setList(result);
    return result;
  };
  useEffect(() => {
    live.current = true;
    const abort = new AbortController();
    void read(abort.signal).catch(error => {
      if (!abort.signal.aborted) setError(error.message);
    });
    return () => {
      live.current = false;
      abort.abort();
    };
  }, [websiteId]);
  const follow = useTaskPolling(
    `${websiteId}:${confirmed?.id || ''}`,
    !!confirmed && ['queued', 'running', 'unknown', 'cleanup'].includes(confirmed.state),
    async signal => {
      const result = await featureRequest<CrawlerDeployment>(
        'GET',
        `${base}/crawler-deployments/${confirmed.id}`,
        undefined,
        signal,
      );
      if (!signal.aborted && live.current) {
        setConfirmed(result);
        setList(previous =>
          previous
            ? {
                ...previous,
                deployments: previous.deployments.map(row => (row.id === result.id ? result : row)),
              }
            : previous,
        );
      }
    },
    5000,
  );

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await work();
    } catch (error: any) {
      if (live.current) setError(error.message || '操作失败，请重试');
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const body = () =>
    crawlerPolicyInputSchema.parse({
      ...draft,
      paths:
        editing &&
        pathText === editing.paths.map(path => path.value).join('\n') &&
        match === editing.paths[0]?.match
          ? editing.paths
          : pathText
              .split('\n')
              .map(value => value.trim())
              .filter(Boolean)
              .map(value => ({ value, match })),
    });
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const value = body();
      const policy = await featureRequest<CrawlerPolicy>(
        editing ? 'PATCH' : 'POST',
        `${base}/crawler-policies${editing ? `/${editing.id}` : ''}`,
        editing ? { ...value, version: editing.version } : value,
      );
      setEditing(policy);
      if (selected?.id === policy.id) setSelected(policy);
      setPreview(null);
      setDraft(value);
      setDirty(false);
      setStatus('草稿已保存。外部访问规则需继续预览并确认。');
      await read();
    });
  }
  async function select(policy: CrawlerPolicy) {
    await run(async () => {
      const detail = await featureRequest<any>('GET', `${base}/crawler-policies/${policy.id}`);
      setSelected(detail.policy || detail);
      setContextCurrent(detail.contextCurrent !== false);
      setVersions(detail.versions || []);
      setTargetVersion('');
      setPreview(null);
      setAcknowledged(false);
      operationId.current = null;
    });
  }
  async function prepare(operation: Preview['operation'] | 'adopt') {
    if (!selected) return;
    await run(async () => {
      const result = await featureRequest<Preview>(
        'POST',
        `${base}/crawler-policies/${selected.id}/${operation === 'adopt' ? 'adopt/preview' : 'preview'}`,
        operation === 'adopt'
          ? {}
          : {
              operation,
              ...(operation === 'rollback' ? { targetVersion: Number(targetVersion) } : {}),
            },
      );
      setPreview(result);
      setAcknowledged(false);
      setConfirmed(null);
      setResolveAck(false);
      operationId.current = null;
    });
  }
  async function confirm() {
    if (!preview || !acknowledged) return;
    await run(async () => {
      operationId.current ||= crypto.randomUUID();
      const result = await featureRequest<CrawlerDeployment>(
        'POST',
        `${base}/crawler-policies/${preview.policyId}/${preview.mode === 'adopt' ? 'adopt' : preview.operation}`,
        { operationId: operationId.current, previewId: preview.id },
      );
      setConfirmed(result);
      setStatus('操作已登记，正在等待 worker 执行与回读。');
      await read();
    });
  }
  return (
    <section>
      <h3>{i18n.text('Cloudflare 访问控制')}</h3>
      {error && <Notice tone="red">{i18n.system(error)}</Notice>}
      {status && <Notice>{i18n.system(status)}</Notice>}
      {!list && (
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await read();
            })
          }
        >
          {i18n.text('重新读取访问策略')}
        </Button>
      )}
      {!canControl && (
        <Notice>
          {i18n.text(
            '当前身份可以查看策略。网站所有者、团队负责人或管理员可以管理连接及远端规则。',
          )}
        </Notice>
      )}
      {list?.controlPaused && (
        <Notice tone="amber">
          {i18n.fragment(
            '系统控制任务已暂停。平台管理员核对当前连接和待确认操作后，可以恢复新操作。',
            false,
            true,
          )}
          {rights.isAdmin && (
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await featureRequest('PATCH', `${base}/control-connections`, { resume: true });
                  setStatus('控制任务已恢复；此前排队的任务已取消，需要重新预览。');
                  await read();
                })
              }
            >
              {i18n.text('核对并恢复控制任务')}
            </Button>
          )}
        </Notice>
      )}
      <p className="muted">
        {i18n.text(
          '网站流量需要经过 Cloudflare 代理。请使用仅限当前 Zone 的独立 Token，包含 Zone 读取和 WAF 规则写入权限。连接测试读取元数据，写入能力在首次确认发布后验证。',
        )}
      </p>
      <Table
        columns={['域名 / Zone', '连接状态', '能力与规则配额', '管理']}
        rows={(list?.connections || []).map(connection => [
          `${connection.domain} · ${connection.zoneId}`,
          <TableCell
            sortValue={states[connection.state]}
            searchValue={i18n.english.system(states[connection.state])}
          >
            {i18n.system(states[connection.state])}
          </TableCell>,
          <TableCell
            sortValue={[
              [
                String(connection.capabilities.plan || i18n.source('套餐待核对')),
                ' \u00B7',
                ' ',
                String(connection.capabilities.used ?? '?'),
                ' /',
                ' ',
                String(connection.capabilities.quota ?? '?'),
              ],
              [
                i18n.source('写入：'),
                connection.capabilities.writeVerified
                  ? i18n.source('已验证')
                  : i18n.source('待验证'),
                i18n.source(' · 真实命中需要有效 Cloudflare 日志'),
              ],
            ]}
            searchValue={[
              [
                String(connection.capabilities.plan || i18n.english.text('套餐待核对')),
                ' \u00B7',
                ' ',
                String(connection.capabilities.used ?? '?'),
                ' /',
                ' ',
                String(connection.capabilities.quota ?? '?'),
              ],
              [
                i18n.english.fragment('写入：', false, true),
                connection.capabilities.writeVerified
                  ? i18n.english.text('已验证')
                  : i18n.english.text('待验证'),
                i18n.english.fragment(' · 真实命中需要有效 Cloudflare 日志', true, false),
              ],
            ]}
          >
            <>
              <span>
                {String(connection.capabilities.plan || i18n.text('套餐待核对'))} ·{' '}
                {String(connection.capabilities.used ?? '?')} /{' '}
                {String(connection.capabilities.quota ?? '?')}
              </span>
              <small className="field-help">
                {i18n.fragment('写入：', false, true)}
                {connection.capabilities.writeVerified ? i18n.text('已验证') : i18n.text('待验证')}
                {i18n.fragment(' · 真实命中需要有效 Cloudflare 日志', true, false)}
              </small>
            </>
          </TableCell>,
          <TableCell
            sortValue={i18n.source('断开并保留规则')}
            searchValue={i18n.english.text('断开并保留规则')}
          >
            <Button
              disabled={busy || !canControl || connection.state === 'disconnected'}
              onClick={() =>
                run(async () => {
                  await featureRequest(
                    'DELETE',
                    `${base}/control-connections/${connection.id}`,
                    {},
                  );
                  setStatus('本地凭据已销毁。远端规则保留，请在 Cloudflare 撤销不用的 Token。');
                  await read();
                })
              }
            >
              {i18n.text('断开并保留规则')}
            </Button>
          </TableCell>,
        ])}
      />
      {canControl && (
        <form
          data-unsaved={!!token || !!zoneId}
          aria-busy={busy}
          onSubmit={event => {
            event.preventDefault();
            void run(async () => {
              const input = crawlerConnectionInputSchema.parse({ zoneId, token });
              try {
                await featureRequest('POST', `${base}/control-connections`, input);
                setZoneId('');
                setStatus('连接读取测试已通过，写入能力等待首次发布验证。');
                await read();
              } finally {
                setToken('');
              }
            });
          }}
        >
          <Field
            label="Cloudflare Zone ID"
            value={zoneId}
            required
            maxLength={32}
            autoComplete="off"
            disabled={busy}
            onChange={event => setZoneId(event.target.value)}
          />
          <Field
            label={i18n.text('独立 API Token')}
            value={token}
            type="password"
            required
            maxLength={512}
            autoComplete="off"
            disabled={busy}
            onChange={event => setToken(event.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || !zoneId || !token}>
            {i18n.text('读取并连接当前 Zone')}
          </button>
        </form>
      )}
      <h3>{i18n.text('访问策略')}</h3>
      <p className="muted">
        {i18n.text(
          '观察只在猎看内分析；屏蔽会发布到 Cloudflare。按声明 UA 匹配，隐藏身份抓取需要现有安全系统继续判断。',
        )}
      </p>
      <Table
        columns={['策略', '本地版本 / 远端版本', '状态', '操作']}
        rows={(list?.policies || []).map(policy => [
          policy.name,
          <TableCell
            sortValue={`${policy.version} / ${policy.appliedVersion ?? i18n.source('尚未发布')}`}
            searchValue={`${policy.version} / ${policy.appliedVersion ?? i18n.english.text('尚未发布')}`}
          >{`${policy.version} / ${policy.appliedVersion ?? i18n.text('尚未发布')}`}</TableCell>,
          <TableCell
            sortValue={states[policy.state]}
            searchValue={i18n.english.system(states[policy.state])}
          >
            {i18n.system(states[policy.state])}
          </TableCell>,
          <TableCell
            sortValue={i18n.source('查看与操作')}
            searchValue={i18n.english.text('查看与操作')}
          >
            <Button disabled={busy} onClick={() => select(policy)}>
              {i18n.text('查看与操作')}
            </Button>
          </TableCell>,
        ])}
      />
      {canDraft && (
        <details open={!!editing}>
          <summary>
            {editing ? i18n.text('编辑 {v0}', [editing.name]) : i18n.text('创建本地草稿')}
          </summary>
          <form data-unsaved={dirty} aria-busy={busy} onSubmit={save}>
            <Field
              label={i18n.text('策略名称')}
              value={draft.name}
              required
              maxLength={80}
              disabled={busy}
              onChange={event => {
                setDraft({ ...draft, name: event.target.value });
                setDirty(true);
              }}
            />
            <fieldset>
              <legend>{i18n.text('蜘蛛，最多 10 个')}</legend>
              {crawlerDirectory
                .filter(bot => bot.control.remote)
                .map(bot => (
                  <label key={bot.id} className="check">
                    <input
                      type="checkbox"
                      checked={draft.botIds.includes(bot.id as any)}
                      disabled={
                        busy || (!draft.botIds.includes(bot.id as any) && draft.botIds.length >= 10)
                      }
                      onChange={event => {
                        setDraft({
                          ...draft,
                          botIds: (event.target.checked
                            ? [...draft.botIds, bot.id]
                            : draft.botIds.filter(id => id !== bot.id)) as any,
                        });
                        setDirty(true);
                      }}
                    />
                    {bot.name}
                  </label>
                ))}
            </fieldset>
            <Select
              label={i18n.text('本地意图')}
              value={draft.action}
              disabled={busy}
              options={[
                ['observe', i18n.text('观察')],
                ['block', i18n.text('屏蔽')],
              ]}
              localizeLabels
              onChange={event => {
                setDraft({ ...draft, action: event.target.value as any });
                setDirty(true);
              }}
            />
            <Select
              label={i18n.text('期望访问状态')}
              value={draft.expectedAccess}
              disabled={busy}
              options={[
                ['allow', i18n.text('期望可访问')],
                ['block', i18n.text('期望被屏蔽')],
              ]}
              localizeLabels
              onChange={event => {
                setDraft({ ...draft, expectedAccess: event.target.value as any });
                setDirty(true);
              }}
            />
            <Select
              label={i18n.text('路径匹配')}
              value={match}
              disabled={busy}
              options={[
                ['exact', i18n.text('精确路径')],
                ['prefix', i18n.text('目录段前缀')],
              ]}
              localizeLabels
              onChange={event => {
                setMatch(event.target.value as any);
                setDirty(true);
              }}
            />
            <label className="field">
              <span>{i18n.text('原编码路径，每行一项，最多 10 项')}</span>
              <textarea
                value={pathText}
                disabled={busy}
                rows={4}
                onChange={event => {
                  setPathText(event.target.value);
                  setDirty(true);
                }}
              />
              <small>
                {i18n.text('保留大小写、尾斜杠和编码。目录 /docs 包含 /docs 与其后代。')}
              </small>
            </label>
            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={busy}>
                {i18n.text('保存草稿')}
              </button>
              {editing && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    setDraft(fresh());
                    setPathText('/docs');
                    setMatch('prefix');
                    setDirty(false);
                  }}
                >
                  {i18n.text('新建草稿')}
                </Button>
              )}
            </div>
          </form>
        </details>
      )}
      {selected && (
        <section>
          <h3>{selected.name}</h3>
          <Definition
            items={[
              [i18n.text('规则身份'), selected.ref],
              [i18n.text('远端规则'), selected.remoteRuleId || i18n.text('尚无远端规则')],
              [i18n.text('配置状态'), i18n.system(states[selected.state])],
            ]}
          />
          {!contextCurrent && (
            <Notice tone="amber">
              {i18n.text(
                '此策略属于此前的网站归属。先核对旧操作结果，再明确接管原规则；接管后才能管理远端配置。',
              )}
            </Notice>
          )}
          <div className="form-actions">
            {canControl && selected.remoteRuleId && (
              <Button disabled={busy || list?.controlPaused} onClick={() => prepare('adopt')}>
                {i18n.text('预览接管原规则')}
              </Button>
            )}
            {canDraft && (
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(selected);
                  setDraft({
                    name: selected.name,
                    botIds: selected.botIds,
                    paths: selected.paths,
                    action: selected.action,
                    expectedAccess: selected.expectedAccess,
                  });
                  setPathText(selected.paths.map(path => path.value).join('\n'));
                  setMatch(selected.paths[0]?.match || 'exact');
                  setDirty(false);
                }}
              >
                {i18n.text('编辑草稿')}
              </Button>
            )}
            <Button
              disabled={
                busy ||
                !(selected.action === 'observe' ? canDraft : canControl) ||
                (selected.action !== 'observe' && list?.controlPaused)
              }
              onClick={() => prepare('deploy')}
            >
              {i18n.text('预览启用')}
            </Button>
            <Button
              disabled={busy || !canControl || list?.controlPaused || !selected.remoteRuleId}
              onClick={() => prepare('stop')}
            >
              {i18n.text('预览停用')}
            </Button>
            <Button
              danger
              disabled={busy || !canControl || list?.controlPaused || !selected.remoteRuleId}
              onClick={() => prepare('cleanup')}
            >
              {i18n.text('预览移除本平台规则')}
            </Button>
          </div>
          <Select
            label={i18n.text('恢复此前版本')}
            value={targetVersion}
            disabled={busy || !canControl}
            options={[
              ['', i18n.text('选择明确版本')],
              ...versions
                .filter(row => row.version !== selected.version)
                .map(row => [String(row.version), `版本 ${row.version}`] as [string, string]),
            ]}
            localizeLabels
            onChange={event => setTargetVersion(event.target.value)}
          />
          <Button
            disabled={busy || !canControl || list?.controlPaused || !targetVersion}
            onClick={() => prepare('rollback')}
          >
            {i18n.text('预览恢复版本')}
          </Button>
        </section>
      )}
      {preview && (
        <section>
          <h3>
            {preview.mode === 'adopt' ? i18n.text('确认规则接管') : i18n.text('确认操作差异')}
          </h3>
          <Definition
            items={[
              [i18n.text('域名 / 版本'), `${preview.hostname} · ${preview.policyVersion}`],
              [i18n.text('操作'), preview.operation],
              [
                i18n.text('历史预计匹配请求'),
                preview.impact.historicalRequests7d.requests == null
                  ? i18n.text('缺少日志')
                  : i18n.text('{v0}（7 天估算，未分类 {v1}）', [
                      preview.impact.historicalRequests7d.requests.toLocaleString('zh-CN'),
                      preview.impact.historicalRequests7d.unclassified,
                    ]),
              ],
              [
                i18n.text('搜索蜘蛛影响'),
                preview.impact.searchBots.join('、') || i18n.text('没有选择搜索蜘蛛'),
              ],
              [
                i18n.text('范围'),
                preview.impact.fullSite ? i18n.text('全站范围') : i18n.text('指定路径'),
              ],
              [i18n.text('执行层'), preview.localOnly ? i18n.text('本地观察') : 'Cloudflare WAF'],
              [i18n.text('预览有效期'), new Date(preview.expiresAt).toLocaleString(i18n.locale)],
            ]}
          />
          {preview.transfer && (
            <Notice tone="amber">
              {i18n.fragment('登记将从连接 ', false, true)}
              {preview.transfer.previous.connectionId}
              {i18n.fragment('（归属版本', true, true)} {preview.transfer.previous.generation}
              {i18n.fragment('）转入连接 ', true, true)}
              {preview.transfer.next.connectionId}
              {i18n.fragment('（归属版本 ', true, true)}
              {preview.transfer.next.generation}）。
              {preview.mode === 'adopt' &&
                i18n.text('本次只读核验远端并更新本地登记。后续修改规则需另行预览确认。')}
            </Notice>
          )}
          <p className="muted">
            {i18n.text(
              '历史预计匹配按 UA 与路径回放。其他 WAF 规则的遮蔽影响需要结合 Cloudflare 实际规则核对；配置回读与真实拦截分别验证。',
            )}
          </p>
          <details>
            <summary>{i18n.text('发布前后表达式与配置')}</summary>
            <pre className="code-block">
              {JSON.stringify(
                { before: preview.before, after: preview.after, expression: preview.expression },
                null,
                2,
              )}
            </pre>
          </details>
          <label className="check">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy || !!confirmed}
              onChange={event => setAcknowledged(event.target.checked)}
            />
            {i18n.fragment('我已核对域名、蜘蛛、路径和访问影响，确认执行此操作。', true, false)}
          </label>
          <Button
            danger={!preview.localOnly}
            primary={preview.localOnly}
            disabled={
              busy || !acknowledged || !!confirmed || Date.parse(preview.expiresAt) < Date.now()
            }
            onClick={confirm}
          >
            {i18n.fragment('确认', false, true)}
            {preview.mode === 'adopt'
              ? i18n.text('接管')
              : preview.operation === 'deploy'
                ? i18n.text('启用')
                : preview.operation === 'stop'
                  ? i18n.text('停用')
                  : preview.operation === 'rollback'
                    ? i18n.text('恢复版本')
                    : i18n.text('移除规则')}
          </Button>
        </section>
      )}
      {confirmed && (
        <Notice
          tone={
            confirmed.state === 'conflict' || confirmed.state === 'failed'
              ? 'red'
              : confirmed.state === 'unknown'
                ? 'amber'
                : ''
          }
        >
          {i18n.fragment('操作 ', false, true)}
          {confirmed.id} · {i18n.system(states[confirmed.state])}
          {follow.expired && (
            <Button onClick={() => follow.resume()}>{i18n.text('回查执行结果')}</Button>
          )}
          {confirmed.errorCode && ` · ${confirmed.errorCode}`}
          {confirmed.state === 'confirmed' && (
            <p>
              {(confirmed as any).mode === 'adopt'
                ? i18n.text('原规则已核验，本地接管登记已完成。后续修改需要重新预览确认。')
                : i18n.text('配置已回读一致。真实规则匹配与本规则拦截需要后续日志证据。')}
            </p>
          )}
          {confirmed.state === 'unknown' && (
            <>
              <p>
                {i18n.text(
                  '结果未知期间暂停重复创建和反向操作。先读取远端状态，再核对本次操作是否执行。',
                )}
              </p>
              {canControl &&
                list?.connections.some(connection => connection.state === 'active') && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={handoffAck}
                      onChange={event => setHandoffAck(event.target.checked)}
                    />
                    {i18n.fragment(
                      '使用当前连接核对此前归属的操作结果，保留原规则归属登记。',
                      true,
                      false,
                    )}
                  </label>
                )}
              <Button
                disabled={busy || !canControl}
                onClick={() =>
                  run(async () => {
                    const result = await featureRequest<CrawlerDeployment>(
                      'POST',
                      `${base}/crawler-deployments/${confirmed.id}/reconcile`,
                      {
                        acknowledgeNotApplied: false,
                        ...(handoffAck
                          ? {
                              acknowledgeHandoff: true,
                              connectionId: list?.connections.find(
                                connection => connection.state === 'active',
                              )?.id,
                            }
                          : {}),
                      },
                    );
                    setConfirmed(result);
                    await read();
                  })
                }
              >
                {i18n.text('重新核对远端结果')}
              </Button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={resolveAck}
                  onChange={event => setResolveAck(event.target.checked)}
                />
                {i18n.fragment(
                  '已确认远端仍保持操作前状态，请核对并结束本次待确认操作。',
                  true,
                  false,
                )}
              </label>
              <Button
                disabled={busy || !canControl || !resolveAck}
                onClick={() =>
                  run(async () => {
                    const result = await featureRequest<CrawlerDeployment>(
                      'POST',
                      `${base}/crawler-deployments/${confirmed.id}/reconcile`,
                      {
                        acknowledgeNotApplied: true,
                        ...(handoffAck
                          ? {
                              acknowledgeHandoff: true,
                              connectionId: list?.connections.find(
                                connection => connection.state === 'active',
                              )?.id,
                            }
                          : {}),
                      },
                    );
                    setConfirmed(result);
                    setPreview(null);
                    await read();
                  })
                }
              >
                {i18n.text('核对未执行并结束待确认')}
              </Button>
            </>
          )}
        </Notice>
      )}
      <details>
        <summary>{i18n.text('近期操作与交接记录')}</summary>
        <Table
          columns={['策略 / 操作', '状态', '记录']}
          rows={(list?.deployments || []).map(item => [
            <TableCell
              sortValue={`${item.policyId} · ${(item as any).mode === 'adopt' ? i18n.source('接管') : item.operation}`}
              searchValue={`${item.policyId} · ${(item as any).mode === 'adopt' ? i18n.english.text('接管') : item.operation}`}
            >{`${item.policyId} · ${(item as any).mode === 'adopt' ? i18n.text('接管') : item.operation}`}</TableCell>,
            <TableCell
              sortValue={states[item.state]}
              searchValue={i18n.english.system(states[item.state])}
            >
              {i18n.system(states[item.state])}
            </TableCell>,
            <TableCell
              sortValue={i18n.source('查看执行记录')}
              searchValue={i18n.english.text('查看执行记录')}
            >
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setResolveAck(false);
                    setHandoffAck(false);
                    setConfirmed(
                      await featureRequest<CrawlerDeployment>(
                        'GET',
                        `${base}/crawler-deployments/${item.id}`,
                      ),
                    );
                  })
                }
              >
                {i18n.text('查看执行记录')}
              </Button>
            </TableCell>,
          ])}
        />
      </details>
    </section>
  );
}
