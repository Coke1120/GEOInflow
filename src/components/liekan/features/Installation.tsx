'use client';
import Link from 'next/link';
import type { FeatureEntity } from '@/lib/liekan/contracts/features';
import {
  installationParams,
  installationStep,
  logMethodLabels,
  logMethodSchema,
  type InstallationAction,
  type InstallationStatus,
  type InstallationStep,
  type LogMethod,
} from '@/lib/liekan/contracts/installation';
import styles from '@/styles/liekan/Installation.module.css';
import { ManagementDrawer } from '../ManagementDrawer';
import { useEffect, useRef, useState } from 'react';
import { useAction, useData, useFeature } from './context';
import { TrackingCode } from './TrackingCode';
import {
  Badge,
  Body,
  Button,
  Code,
  Definition,
  Icon,
  LinkButton,
  Notice,
  Panel,
  QueryState,
} from './ui';

function useInstallation(websiteId: string) {
  const c = useFeature();
  return useData<InstallationStatus>(
    ['website-installation', websiteId],
    signal => c.api.get(`/liekan/websites/${websiteId}/installation`, undefined, signal),
    !!websiteId,
  );
}
const dateLabel = (value: string | null, timezone: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { timeZone: timezone }) : '尚未接收';
const demoCopy = '当前网站包含演示数据。示例浏览访问和日志不能证明网站 JS 或自动采集服务已经运行。';
function browserLabel(browser: any, deferred: boolean, demo = false) {
  if (browser.error) return '读取失败';
  if (browser.isPending) return '正在检查';
  if (!browser.data) return '状态未验证';
  if (browser.data.pageviews > 0) return demo ? '已有示例浏览数据' : '已收到浏览数据';
  return deferred ? '检查已延后' : '尚未收到浏览数据';
}
function logLabel(status: InstallationStatus) {
  if (status.logs.total > 0) return status.logs.demo ? '已有示例日志' : '已收到日志数据';
  return status.progress.logCheckDeferred ? '检查已延后' : '尚未收到日志';
}
function tone(label: string) {
  return label === '已收到浏览数据' || label === '已收到日志数据'
    ? 'green'
    : label === '读取失败'
      ? 'red'
      : 'gray';
}

export function InstallationEntry({ site, browser }: { site: FeatureEntity; browser: any }) {
  const c = useFeature();
  const query = useInstallation(site.id);
  const status = query.data;
  return (
    <Panel title="数据接入" subtitle="获取安装代码、连接日志，或继续上次的检查。">
      <Body>
        <QueryState query={query}>
          {status && (
            <div className={styles.summary}>
              <div>
                <strong>{status.progress.completedAt ? '设置已完成' : '接入设置待完成'}</strong>
                <p className="muted">
                  {status.progress.completedAt
                    ? `保存于 ${dateLabel(status.progress.completedAt, c.range.timezone || 'Asia/Shanghai')}`
                    : '检查可以延后，完成设置后可随时继续。'}
                </p>
              </div>
              <div className={styles.badges}>
                <Badge
                  tone={tone(
                    browserLabel(browser, status.progress.browserCheckDeferred, status.logs.demo),
                  )}
                >
                  JS ·{' '}
                  {browserLabel(browser, status.progress.browserCheckDeferred, status.logs.demo)}
                </Badge>
                <Badge tone={tone(logLabel(status))}>日志 · {logLabel(status)}</Badge>
              </div>
            </div>
          )}
        </QueryState>
        {status?.logs.demo && <Notice tone="amber">{demoCopy}</Notice>}
        <div className="form-actions">
          <LinkButton page="website-settings" params={installationParams(site.id, 'js')}>
            获取 JS 代码
          </LinkButton>
          <LinkButton
            page="website-settings"
            params={installationParams(site.id, 'logs', 'cloudflare')}
          >
            授权连接页面
          </LinkButton>
          <LinkButton
            page="website-settings"
            params={installationParams(site.id, 'logs', 'server')}
          >
            服务器安装页面
          </LinkButton>
          <LinkButton page="website-settings" params={installationParams(site.id, 'check')}>
            继续检查
          </LinkButton>
        </div>
      </Body>
    </Panel>
  );
}

export function Installation({
  site,
  browser,
  manage,
  entry,
}: {
  site: FeatureEntity;
  browser: any;
  manage: boolean;
  entry?: 'js' | 'check';
}) {
  const c = useFeature();
  const query = useInstallation(site.id);
  const action = useAction();
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState<{ method: LogMethod; navigationVersion: number } | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const status = query.data;
  const parsedMethod = logMethodSchema.safeParse(c.query.method);
  const step: InstallationStep =
    installationStep(c.query.step) ||
    entry ||
    (status?.progress.completedAt ? 'overview' : status?.progress.lastStep || 'js');
  const canSave = manage && !!status?.canManage;
  const navigationKey = JSON.stringify([
    entry,
    c.route.page,
    c.query.section,
    c.query.step,
    c.query.method,
  ]);
  const navigation = useRef({ key: navigationKey, version: 0 });
  if (navigation.current.key !== navigationKey) {
    navigation.current = { key: navigationKey, version: navigation.current.version + 1 };
  }
  const method: LogMethod = ['complete', 'overview', 'check'].includes(step)
    ? status?.progress.method || 'cloudflare'
    : draft?.navigationVersion === navigation.current.version
      ? draft.method
      : parsedMethod.success
        ? parsedMethod.data
        : status?.progress.method || 'cloudflare';
  const timezone = c.range.timezone || 'Asia/Shanghai';
  const href = (step: InstallationStep, chosen?: LogMethod) =>
    c.href('website-settings', installationParams(site.id, step, chosen));
  const navigate = (step: InstallationStep, chosen?: LogMethod) =>
    c.navigate('website-settings', installationParams(site.id, step, chosen));
  async function save(body: InstallationAction, next?: InstallationStep) {
    if (!canSave) throw new Error('保存接入设置需要网站管理权限。');
    const version = navigation.current.version;
    await action.run(
      () => c.api.post(`/liekan/websites/${site.id}/installation`, body),
      body.action === 'finish' ? `「${site.name}」的接入设置已完成` : '接入进度已保存',
    );
    if (next && active.current && version === navigation.current.version)
      navigate(next, 'method' in body ? body.method : method);
  }
  async function selectMethod(chosen: LogMethod) {
    setDraft({ method: chosen, navigationVersion: navigation.current.version });
    navigate('logs', chosen);
    await save({ action: 'select-method', method: chosen });
  }
  const checking = browser.isFetching || query.isFetching;
  async function recheck() {
    const results = await Promise.all([browser.refetch(), query.refetch()]);
    if (results.some(result => result.error))
      throw new Error('部分状态读取失败，请查看检查结果后重试。');
    c.notify('采集状态已更新');
  }
  const browserState = browserLabel(
    browser,
    !!status?.progress.browserCheckDeferred,
    status?.logs.demo,
  );
  const browserReceived = !browser.error && browser.data?.pageviews > 0;
  const logReceived = !!status?.logs.total;
  const summary = status && (
    <div className={styles.receipts}>
      <div>
        <span className="muted">浏览采集</span>
        <Badge tone={tone(browserState)}>{browserState}</Badge>
        <p className="muted">
          {browserReceived
            ? `${browser.data.pageviews.toLocaleString()} 次页面访问${status.logs.demo ? '（含示例数据）' : ''}`
            : 'JS 安装后，打开目标网站产生一次访问。'}
        </p>
      </div>
      <div>
        <span className="muted">日志采集</span>
        <Badge tone={tone(logLabel(status))}>{logLabel(status)}</Badge>
        <p className="muted">
          {logReceived
            ? `${status.logs.total.toLocaleString()} 条日志 · ${status.logs.ai.toLocaleString()} 次 AI 蜘蛛匹配`
            : '服务器或 CDN 日志用于统计 AI 蜘蛛请求。'}
        </p>
      </div>
    </div>
  );
  const demoNotice = status?.logs.demo && <Notice tone="amber">{demoCopy}</Notice>;
  const checks = status && (
    <div className={styles.checks}>
      <div className={styles.checkRow}>
        <div>
          <strong>JS 浏览数据</strong>
          <p className="muted">
            {browserReceived && !status.logs.demo
              ? '已收到页面访问；脚本加载仍可在目标网站核对。'
              : '打开目标网站，确认脚本加载与网站标识，再检查访问是否到达。'}
          </p>
          {browser.error && (
            <p role="alert" className="field-error">
              {browser.error.message || '浏览统计读取失败，请重试。'}
            </p>
          )}
        </div>
        <Badge tone={tone(browserState)}>{browserState}</Badge>
      </div>
      <div className={styles.checkRow}>
        <div>
          <strong>自动日志接入</strong>
          <p className="muted">当前实例尚未开放 Cloudflare 授权与服务器采集服务。</p>
        </div>
        <Badge>未启用</Badge>
      </div>
      <div className={styles.checkRow}>
        <div>
          <strong>日志接收</strong>
          <p className="muted">
            {logReceived
              ? `最近日志：${dateLabel(status.logs.latestAt, timezone)}；当前数据通过导入获得。`
              : '导入真实访问日志后，检查接收条数与时间。'}
          </p>
        </div>
        <Badge tone={tone(logLabel(status))}>{logLabel(status)}</Badge>
      </div>
      <div className={styles.checkRow}>
        <div>
          <strong>AI 蜘蛛匹配</strong>
          <p className="muted">
            {logReceived
              ? status.logs.ai
                ? '根据日志中的请求特征匹配。身份核验结果可在日志中查看。'
                : '日志已收到，暂未匹配到 AI 蜘蛛请求。'
              : '收到有效日志后进行识别。'}
          </p>
        </div>
        <Badge tone={logReceived ? 'blue' : 'gray'}>
          {logReceived ? `${status.logs.ai.toLocaleString()} 次匹配` : '等待日志'}
        </Badge>
      </div>
      <p className="field-help">
        检查范围：当前网站创建至今的浏览访问与所有已导入日志。延后检查会保留实际数据和错误状态。
      </p>
      {demoNotice}
    </div>
  );

  return (
    <div className={styles.flow}>
      <div className={styles.context}>
        <div>
          <strong>{site.name}</strong>
          <span className="muted">{site.domain}</span>
        </div>
        <LinkButton page="website-settings" params={{ websiteId: site.id }}>
          返回网站设置
        </LinkButton>
      </div>
      <QueryState query={query}>
        {status && (
          <>
            {!canSave && (
              <Notice tone="amber">当前角色可查看安装说明。保存接入进度需要网站管理权限。</Notice>
            )}
            {['js', 'logs', 'finish'].includes(step) && (
              <nav className={styles.steps} aria-label="接入设置步骤">
                {(
                  [
                    ['js', '安装 JS'],
                    ['logs', '接入日志'],
                    ['finish', '完成设置'],
                  ] as const
                ).map(([id, label], index) => (
                  <Link
                    key={id}
                    prefetch={false}
                    href={href(id, method)}
                    aria-current={step === id ? 'step' : undefined}
                  >
                    <span>{index + 1}</span>
                    <strong>{label}</strong>
                  </Link>
                ))}
              </nav>
            )}
            {step === 'js' && (
              <div className={styles.layout}>
                <Panel
                  title="安装网站统计 JS"
                  subtitle="将代码加入网站公共模板，覆盖需要统计的页面。"
                >
                  <Body>
                    <TrackingCode websiteId={site.id} />
                    <div className={styles.inlineStatus}>
                      <Badge tone={tone(browserState)}>{browserState}</Badge>
                      <Button disabled={checking} onClick={recheck}>
                        检查安装结果（可选）
                      </Button>
                    </div>
                    {demoNotice}
                    <details className={styles.details}>
                      <summary>安装说明与自定义事件</summary>
                      <div className="stack">
                        <p>
                          HTML 网站放在公共模板的 head 中；Next.js
                          使用上方示例；标签管理器选择自定义 HTML 标签。
                        </p>
                        <p>
                          单页应用默认跟踪路由变化。内容安全策略需允许统计服务的脚本和采集地址。
                        </p>
                        <Code>
                          {"umami.track('demo_submit', { plan: 'growth', placement: 'header' });"}
                        </Code>
                        <LinkButton page="recorder-settings" params={{ websiteId: site.id }}>
                          回放与热力图设置
                        </LinkButton>
                      </div>
                    </details>
                    <div className={styles.footer}>
                      <span className="muted">可以先完成设置，稍后验证安装。</span>
                      <div className="row">
                        {browserReceived &&
                          (canSave ? (
                            <Button
                              primary
                              disabled={action.busy}
                              onClick={() =>
                                save({ action: 'continue', step: 'logs', method }, 'logs')
                              }
                            >
                              下一步：接入日志
                            </Button>
                          ) : (
                            <LinkButton
                              page="website-settings"
                              params={installationParams(site.id, 'logs', method)}
                              primary
                            >
                              下一步：接入日志
                            </LinkButton>
                          ))}
                        <Button
                          primary={!browserReceived}
                          disabled={action.busy || !canSave}
                          onClick={() => save({ action: 'skip-browser' }, 'logs')}
                        >
                          跳过检查，下一步
                        </Button>
                      </div>
                    </div>
                  </Body>
                </Panel>
                <Panel title="两种数据，一处接入" subtitle="根据分析目标选择接入方式。">
                  <Body>
                    <div className="stack">
                      <div>
                        <h3>浏览访问与转化</h3>
                        <p className="muted">
                          网站 JS 采集页面访问和事件，支持来源、目标与漏斗分析。
                        </p>
                      </div>
                      <div>
                        <h3>AI 蜘蛛与抓取</h3>
                        <p className="muted">日志记录请求与蜘蛛访问。多数蜘蛛不会执行页面 JS。</p>
                      </div>
                      <div>
                        <h3>随时继续</h3>
                        <p className="muted">
                          每一步都可以延后检查，从网站设置回到当前网站的对应页面。
                        </p>
                      </div>
                    </div>
                  </Body>
                </Panel>
              </div>
            )}
            {step === 'logs' && (
              <Panel title="接入 AI 蜘蛛日志" subtitle="选择日志来源；检查可以延后。">
                <Body>
                  <fieldset className={styles.methods}>
                    <legend>选择接入方式</legend>
                    {(['cloudflare', 'server', 'manual'] as const).map(value => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="log-method"
                          value={value}
                          checked={method === value}
                          disabled={action.busy || !canSave}
                          onChange={() => {
                            void selectMethod(value).catch(() => {});
                          }}
                        />
                        <span>
                          <strong>{logMethodLabels[value]}</strong>
                          <small>
                            {value === 'cloudflare'
                              ? '覆盖 CDN 边缘请求'
                              : value === 'server'
                                ? '覆盖服务器回源请求'
                                : '上传已有访问日志'}
                          </small>
                        </span>
                        <Badge tone={value === 'manual' ? 'blue' : 'gray'}>
                          {value === 'manual' ? '可用' : '暂未开放'}
                        </Badge>
                      </label>
                    ))}
                  </fieldset>
                  {method !== 'manual' ? (
                    <div className={styles.source}>
                      <div className={styles.sourceTitle}>
                        <Icon name={method === 'cloudflare' ? 'globe' : 'code'} />
                        <h3>{logMethodLabels[method]}</h3>
                        <Badge>当前实例未启用</Badge>
                      </div>
                      <p>
                        {method === 'cloudflare'
                          ? '授权后选择与当前网站匹配的域名，由 CDN 持续推送访问日志。'
                          : '在网站服务器执行一次安装，采集服务持续发送该网站的访问日志。'}
                      </p>
                      <p className="muted">
                        {method === 'cloudflare'
                          ? '当前实例还没有可用的授权应用与日志接收服务，因此暂不能生成授权链接。'
                          : '当前实例还没有可用的安装包、配对与日志接收服务，因此暂不能生成安装命令。'}
                      </p>
                      <div className="form-actions">
                        <Button disabled>
                          {method === 'cloudflare' ? '生成授权链接' : '生成一次安装命令'}
                        </Button>
                        <Button
                          disabled={action.busy || !canSave}
                          onClick={() => selectMethod('manual')}
                        >
                          使用手动导入
                        </Button>
                      </div>
                      <p className="field-help">
                        覆盖范围：
                        {method === 'cloudflare'
                          ? 'CDN 请求，可包含缓存命中；实际字段取决于账号能力。'
                          : '源站请求；CDN 缓存命中与边缘拦截通常不进入源站日志。'}
                      </p>
                    </div>
                  ) : (
                    <div className={styles.source}>
                      <h3>导入当前网站的访问日志</h3>
                      <p>
                        支持 Nginx / Apache Combined 与标准 JSON，导入后自动解析请求并匹配蜘蛛。
                      </p>
                      <p className="muted">
                        原生 CDN 日志需转换为支持的字段格式。请确认日志属于 {site.domain}。
                      </p>
                      <div className="form-actions">
                        <Button primary disabled={!canSave} onClick={() => setImportOpen(true)}>
                          导入该网站日志
                        </Button>
                        <LinkButton page="geo-logs" params={{ websiteId: site.id }}>
                          查看该网站日志
                        </LinkButton>
                      </div>
                    </div>
                  )}
                  <div className={styles.inlineStatus}>
                    <Badge tone={tone(logLabel(status))}>{logLabel(status)}</Badge>
                    <Button disabled={checking} onClick={recheck}>
                      检查日志接收（可选）
                    </Button>
                  </div>
                  {demoNotice}
                  <div className={styles.footer}>
                    <LinkButton page="website-settings" params={installationParams(site.id, 'js')}>
                      上一步
                    </LinkButton>
                    <div className="row">
                      {logReceived &&
                        (canSave ? (
                          <Button
                            primary
                            disabled={action.busy}
                            onClick={() =>
                              save({ action: 'continue', step: 'finish', method }, 'finish')
                            }
                          >
                            下一步：完成设置
                          </Button>
                        ) : (
                          <LinkButton
                            page="website-settings"
                            params={installationParams(site.id, 'finish', method)}
                            primary
                          >
                            下一步：完成设置
                          </LinkButton>
                        ))}
                      <Button
                        primary={!logReceived}
                        disabled={action.busy || !canSave}
                        onClick={() => save({ action: 'skip-logs', method }, 'finish')}
                      >
                        跳过检查，继续
                      </Button>
                    </div>
                  </div>
                </Body>
              </Panel>
            )}
            {step === 'finish' && (
              <Panel title="完成接入设置" subtitle="确认当前网站的选择，检查结果可稍后补充。">
                <Body>
                  <Definition
                    items={[
                      ['网站', `${site.name} · ${site.domain}`],
                      ['日志接入方式', logMethodLabels[method]],
                      ['自动接入', '当前实例未启用'],
                    ]}
                  />
                  {summary}
                  <Notice tone="blue">
                    完成后会保存接入设置。尚未收到的数据仍显示等待，可从网站设置继续安装或检查。
                  </Notice>
                  <details className={styles.details}>
                    <summary>查看检查结果（可选）</summary>
                    {checks}
                    <div className="form-actions">
                      <Button disabled={checking} onClick={recheck}>
                        重新检查
                      </Button>
                    </div>
                  </details>
                  <div className={styles.footer}>
                    <LinkButton
                      page="website-settings"
                      params={installationParams(site.id, 'logs', method)}
                    >
                      上一步
                    </LinkButton>
                    <Button
                      primary
                      disabled={action.busy || !canSave}
                      onClick={() => save({ action: 'finish', method }, 'complete')}
                    >
                      {action.busy ? '正在保存…' : '完成设置'}
                    </Button>
                  </div>
                </Body>
              </Panel>
            )}
            {(step === 'complete' || step === 'overview') && (
              <Panel
                title={status.progress.completedAt ? '设置已完成' : '接入设置待完成'}
                subtitle="当前网站的安装、日志接入与检查入口。"
              >
                <Body>
                  {status.progress.completedAt && (
                    <div className={styles.complete}>
                      <span>
                        <Icon name="check" />
                      </span>
                      <div>
                        <h3>接入设置已保存</h3>
                        <p className="muted">后续可随时调整安装方式并继续检查。</p>
                      </div>
                    </div>
                  )}
                  {summary}
                  <div className={styles.entryRow}>
                    <div>
                      <strong>网站统计 JS</strong>
                      <p className="muted">获取代码，或核对已安装的脚本。</p>
                    </div>
                    <LinkButton page="website-settings" params={installationParams(site.id, 'js')}>
                      获取 JS 代码
                    </LinkButton>
                  </div>
                  <div className={styles.entryRow}>
                    <div>
                      <strong>{logMethodLabels[method]}</strong>
                      <p className="muted">
                        {method === 'manual'
                          ? '导入真实日志后查看蜘蛛请求。'
                          : '自动接入暂未开放，可使用手动导入。'}
                      </p>
                    </div>
                    <LinkButton
                      page="website-settings"
                      params={installationParams(site.id, 'logs', method)}
                    >
                      {method === 'cloudflare'
                        ? '授权连接页面'
                        : method === 'server'
                          ? '服务器安装页面'
                          : '日志导入页面'}
                    </LinkButton>
                  </div>
                  <div className={styles.entryRow}>
                    <div>
                      <strong>接入检查</strong>
                      <p className="muted">浏览访问、日志接收与 AI 蜘蛛匹配。</p>
                    </div>
                    <LinkButton
                      page="website-settings"
                      params={installationParams(site.id, 'check')}
                    >
                      继续检查
                    </LinkButton>
                  </div>
                  {demoNotice}
                  <div className="form-actions">
                    <LinkButton page="website-settings" params={{ websiteId: site.id }} primary>
                      返回网站设置
                    </LinkButton>
                    <LinkButton page="overview" params={{ websiteId: site.id }}>
                      查看该网站统计
                    </LinkButton>
                    {!status.progress.completedAt && (
                      <LinkButton
                        page="website-settings"
                        params={installationParams(site.id, 'finish', method)}
                      >
                        完成设置
                      </LinkButton>
                    )}
                  </div>
                </Body>
              </Panel>
            )}
            {step === 'check' && (
              <Panel
                title="接入检查"
                subtitle="检查真实接收结果；每项检查均可延后。"
                actions={
                  <Button disabled={checking} onClick={recheck}>
                    重新检查
                  </Button>
                }
              >
                <Body>
                  {checks}
                  <div className="form-actions">
                    <LinkButton page="website-settings" params={installationParams(site.id, 'js')}>
                      查看跟踪代码
                    </LinkButton>
                    <LinkButton
                      page="website-settings"
                      params={installationParams(site.id, 'logs', method)}
                    >
                      日志接入设置
                    </LinkButton>
                    <LinkButton page="geo-logs" params={{ websiteId: site.id }}>
                      查看该网站日志
                    </LinkButton>
                    <Button
                      primary
                      disabled={action.busy || !canSave}
                      onClick={() => save({ action: 'skip-checks', method }, 'finish')}
                    >
                      跳过检查，继续设置
                    </Button>
                  </div>
                </Body>
              </Panel>
            )}
            {action.error && <Notice tone="red">{action.error}</Notice>}
            {importOpen && (
              <ManagementDrawer
                key={site.id}
                action="导入日志"
                websiteId={site.id}
                canManage={canSave}
                onClose={() => setImportOpen(false)}
                onSaved={() => c.refresh()}
                onSearch={search => c.navigate('geo-logs', { websiteId: site.id, search })}
                onRange={(start, end) =>
                  c.navigate('geo-logs', { websiteId: site.id, date: `range:${start}:${end}` })
                }
              />
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
