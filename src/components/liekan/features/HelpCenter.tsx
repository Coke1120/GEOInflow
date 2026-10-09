'use client';
import Link from '@/components/liekan/Link';
import { useEffect, useRef, useState } from 'react';
import {
  crawlerCapabilities,
  crawlerRobotsDraft,
  crawlerSnapshot,
  helpArticles,
  helpCrawlers,
  helpIdentityCount,
  helpLocation,
  helpRuleCount,
  helpSections,
  searchArticles,
  searchCrawlers,
  snapshotState,
} from '@/lib/liekan/help/catalog';
import {
  type Crawler,
  HELP_REVIEWED_AT,
  type HelpArticle,
  type HelpSource,
} from '@/lib/liekan/help/types';
import styles from '@/styles/liekan/Help.module.css';
import { useFeature } from './context';
import { featureHref } from './routes';
import { Icon } from './ui';

const href = (params: Record<string, string> = {}) => featureHref('help', params);
const purposes = [...new Set(helpCrawlers.flatMap(item => item.purposes))];
const vendors = [...new Set(helpCrawlers.map(item => item.vendor))];
const evidenceLabels = {
  operator: '厂商官方',
  observed: 'CDN 观察',
  pending: '待复核',
  inactive: '当前未活跃',
};
const dateLabel = (value?: string) => {
  const time = value && Date.parse(value);
  return time && Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : '未提供';
};
function Sources({ sources }: { sources: HelpSource[] }) {
  return (
    <ul className={styles.sources}>
      {sources.map(item => (
        <li key={item.url}>
          <a
            href={item.url}
            {...(item.url.startsWith('https://')
              ? { target: '_blank', rel: 'noopener noreferrer' }
              : {})}
          >
            {item.label}
            <Icon name="external" />
          </a>
        </li>
      ))}
    </ul>
  );
}
function Draft({ label, text, filename }: { label: string; text: string; filename: string }) {
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      if (alive.current) setMessage('已复制配置草稿');
    } catch {
      if (alive.current) setMessage('复制未完成，请选择下方文本手动复制。');
    }
  }
  function download() {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setMessage('已下载配置草稿，请审核后部署到源站。');
    } catch {
      setMessage('下载未完成，请复制下方文本。');
    } finally {
      if (url) {
        const resource = url;
        setTimeout(() => URL.revokeObjectURL(resource), 1000);
      }
    }
  }
  return (
    <div className={styles.draft}>
      <div className={styles.draftHeader}>
        <span>{label}</span>
        <div>
          <button type="button" onClick={copy}>
            复制
          </button>
          <button type="button" onClick={download}>
            下载草稿
          </button>
        </div>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code>{text}</code>
      </pre>
      <p role="status">{message}</p>
    </div>
  );
}
function ArticleDetail({ article }: { article: HelpArticle }) {
  return (
    <div className={styles.reading}>
      <article className={styles.paper}>
        <header>
          <p className={styles.eyebrow}>
            {helpSections.find(item => item.id === article.section)?.title}
          </p>
          <h2>{article.title}</h2>
          <p>{article.summary}</p>
          <small>资料复核：{article.reviewedAt} · 随本版产品维护</small>
        </header>
        {article.setupGuide && (
          <section className={styles.setupGuide} aria-label="AI 蜘蛛接入引导">
            <h3>开始配置本站采集</h3>
            <p>先选择目标网站，再打开“网站设置 → 数据接入”，按页面引导连接日志来源。</p>
            <Link prefetch={false} href={featureHref('websites')}>
              选择网站并开始接入
            </Link>
          </section>
        )}
        {article.blocks.map((block, index) => (
          <section id={`help-block-${index}`} key={block.title}>
            <h3>{block.title}</h3>
            {block.paragraphs.map(text => (
              <p key={text}>{text}</p>
            ))}
            {block.code && <Draft {...block.code} />}
          </section>
        ))}
        {!!article.sources.length && (
          <section>
            <h3>参考资料</h3>
            <Sources sources={article.sources} />
          </section>
        )}
        {!!article.related.length && (
          <section>
            <h3>相关文档</h3>
            <ul className={styles.related}>
              {article.related.map(id => {
                const item = helpArticles.find(item => item.id === id);
                return (
                  item && (
                    <li key={id}>
                      <Link prefetch={false} href={href({ article: id })}>
                        {item.title}
                      </Link>
                    </li>
                  )
                );
              })}
            </ul>
          </section>
        )}
      </article>
      <aside className={styles.contents} aria-label="文档目录">
        <h3>本文目录</h3>
        {article.blocks.map((block, index) => (
          <a key={block.title} href={`#help-block-${index}`}>
            {block.title}
          </a>
        ))}
      </aside>
    </div>
  );
}
function Capabilities({ crawler }: { crawler: Crawler }) {
  const { rule, ip } = crawlerCapabilities(crawler);
  return (
    <div className={styles.capabilities}>
      <span>资料{crawler.evidence === 'pending' ? '待复核' : '已收录'}</span>
      <span className={rule ? styles.supported : ''}>
        {rule
          ? `默认分类：${rule.name}`
          : crawler.kind === 'control'
            ? '用途控制标记'
            : '默认 UA 分类未支持'}
      </span>
      <span className={ip ? styles.supported : ''}>
        {ip ? '默认 IP 核验支持' : '默认 IP 核验未支持'}
      </span>
    </div>
  );
}
function CrawlerDetail({ crawler }: { crawler: Crawler }) {
  const range = crawlerSnapshot(crawler);
  const status = snapshotState(range);
  const draft = crawlerRobotsDraft(crawler);
  return (
    <article className={`${styles.paper} ${styles.crawlerDetail}`}>
      <header>
        <p className={styles.eyebrow}>
          {crawler.vendor} · {evidenceLabels[crawler.evidence]}
        </p>
        <h2>{crawler.name}</h2>
        <p>{crawler.summary}</p>
        <Capabilities crawler={crawler} />
        <small>资料复核：{crawler.reviewedAt}</small>
      </header>
      <section>
        <h3>用途与请求标记</h3>
        <dl className={styles.facts}>
          <div>
            <dt>用途</dt>
            <dd>{crawler.purposes.join(' / ')}</dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>
              {crawler.kind === 'control'
                ? 'robots 用途控制标记，无独立 HTTP UA'
                : 'HTTP crawler / 获取器'}
            </dd>
          </div>
          <div>
            <dt>UA 稳定标记</dt>
            <dd>
              <code>{crawler.token || '无独立 UA'}</code>
            </dd>
          </div>
          <div>
            <dt>robots token</dt>
            <dd>
              <code>{crawler.robotsToken || '待复核'}</code>
            </dd>
          </div>
          {!!crawler.aliases.length && (
            <div>
              <dt>别名</dt>
              <dd>{crawler.aliases.join(' / ')}</dd>
            </div>
          )}
        </dl>
        {crawler.ua ? (
          <div className={styles.ua}>
            <p>官方文档中的 UA 示例；版本与平台形态可能变化。</p>
            <pre tabIndex={0}>
              <code>{crawler.ua}</code>
            </pre>
          </div>
        ) : (
          <p className={styles.muted}>
            {crawler.kind === 'control'
              ? '该标记通过 robots 控制用途，不产生独立请求头。'
              : '本条保留官方稳定标记，完整 UA 示例尚未随本版转录。核验时以当前官方文档为准。'}
          </p>
        )}
      </section>
      <section>
        <h3>IP 来源与身份核验</h3>
        <p>{crawler.verification}</p>
        {crawler.feeds.length ? (
          <Sources sources={crawler.feeds} />
        ) : (
          <p className={styles.muted}>
            本条尚无随附的可下载官方 IP feed，其他官方检查方法见下方资料。
          </p>
        )}
        {range ? (
          <div className={styles.range}>
            <p>
              <strong>
                {status === 'stale' ? '随版快照已过 7 天，请复核官方来源' : '随版官方范围快照'}
              </strong>
            </p>
            <p>
              获取：{dateLabel(range.retrievedAt)} · 发布：{dateLabel(range.publishedAt)} · IPv4：
              {range.prefixes.filter(ip => !ip.includes(':')).length} 段 · IPv6：
              {range.prefixes.filter(ip => ip.includes(':')).length} 段
            </p>
            <p>此处展示随版本附带的公开网段；实时日志核验使用实际处理时的快照与请求时间。</p>
            <details>
              <summary>查看 {range.prefixes.length} 个公开 CIDR 网段</summary>
              <pre tabIndex={0}>{range.prefixes.join('\n')}</pre>
            </details>
          </div>
        ) : (
          crawler.feeds.length > 0 && (
            <p className={styles.muted}>
              官方来源已收录，范围数据尚未随本版附带。打开官方 feed 获取当前 IPv4/IPv6 与发布时间。
            </p>
          )
        )}
        <Link prefetch={false} href={href({ article: 'identity-check' })}>
          阅读身份核验步骤
        </Link>
      </section>
      <section>
        <h3>访问控制与处理建议</h3>
        <p>{crawler.robots}</p>
        <p>{crawler.advice}</p>
        <p>
          官方来源也需核对适用时间、用途与范围。身份核验通过后，继续按站点授权和访问成本决定策略。
        </p>
        {draft && (
          <Draft
            key={crawler.id}
            label="配置草稿 · 拒绝此 token，合并已有 robots 后再部署"
            text={draft}
            filename={`${crawler.id}-robots-draft.txt`}
          />
        )}
        <Link prefetch={false} href={href({ article: 'robots-policy' })}>
          阅读 robots、索引与限速指南
        </Link>
      </section>
      <section>
        <h3>权威资料与维护</h3>
        <Sources sources={crawler.sources} />
        <p className={styles.muted}>
          厂商官方资料优先；CDN 观察和待复核条目保留来源标签。IP
          与文档随版本复核，过期资料需重新查证。
        </p>
      </section>
    </article>
  );
}
function ArticleList({ articles }: { articles: HelpArticle[] }) {
  return (
    <ul className={styles.articleList}>
      {articles.map(item => (
        <li key={item.id}>
          <Link prefetch={false} href={href({ article: item.id })}>
            <div>
              <span className={styles.eyebrow}>
                {helpSections.find(section => section.id === item.section)?.title}
              </span>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
            </div>
            <span aria-hidden="true">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
function CrawlerList({ crawlers }: { crawlers: Crawler[] }) {
  return (
    <ul className={styles.crawlerList}>
      {crawlers.map(item => (
        <li key={item.id}>
          <Link prefetch={false} href={href({ crawler: item.id })}>
            <div className={styles.crawlerName}>
              <strong>{item.name}</strong>
              <small>{item.vendor}</small>
            </div>
            <div>
              <span className={styles.purpose}>{item.purposes.join(' / ')}</span>
              <p>{item.summary}</p>
            </div>
            <div className={styles.crawlerState}>
              <span>
                {evidenceLabels[item.evidence]}
                {item.kind === 'control' ? ' · 控制标记' : ''}
              </span>
              <Capabilities crawler={item} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function HelpCenter() {
  const c = useFeature();
  const location = helpLocation(c.query);
  const [search, setSearch] = useState('');
  const [purpose, setPurpose] = useState('');
  const [vendor, setVendor] = useState('');
  const [kind, setKind] = useState('');
  const [limit, setLimit] = useState(20);
  const searching = search.trim().length > 0;
  const detail = !searching && (location.article || location.crawler);
  const category = searching ? undefined : location.section;
  const articles = searchArticles(search, category === 'crawlers' ? '__none__' : category);
  const crawlers = searchCrawlers(
    search,
    category === 'crawlers' ? purpose : '',
    category === 'crawlers' ? vendor : '',
    category === 'crawlers' ? kind : '',
  );
  useEffect(() => {
    setLimit(20);
  }, [search, purpose, vendor, kind, category]);
  const locationKey = ['section', 'article', 'crawler'].map(key => c.query[key] || '').join('/');
  const pendingNavigation = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (pendingNavigation.current !== locationKey) setSearch('');
    pendingNavigation.current = undefined;
  }, [locationKey]);
  function clearForLink(event: React.MouseEvent<HTMLDivElement>) {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== '/liekan/help') return;
    const nextKey = ['section', 'article', 'crawler']
      .map(key => url.searchParams.get(key) || '')
      .join('/');
    pendingNavigation.current = nextKey === locationKey ? undefined : nextKey;
    setSearch('');
  }

  const heading = searching ? '搜索结果' : helpSections.find(item => item.id === category)?.title;
  return (
    <div className={styles.help} data-help-center="true" onClickCapture={clearForLink}>
      <form className={styles.search} role="search" onSubmit={event => event.preventDefault()}>
        <Icon name="search" />
        <label className={styles.srOnly} htmlFor="help-search">
          搜索帮助文档或蜘蛛
        </label>
        <input
          id="help-search"
          type="search"
          maxLength={256}
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="搜索指标、配置、蜘蛛名称或 User-Agent…"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')}>
            清空
          </button>
        )}
      </form>
      <nav className={styles.categories} aria-label="帮助分类">
        <Link
          prefetch={false}
          href={href()}
          aria-current={!location.section && !location.invalid ? 'page' : undefined}
        >
          全部资料
        </Link>
        {helpSections.map(item => (
          <Link
            prefetch={false}
            key={item.id}
            href={href({ section: item.id })}
            aria-current={location.section === item.id ? 'page' : undefined}
          >
            {item.title}
          </Link>
        ))}
      </nav>
      {location.invalid && !searching ? (
        <section className={styles.empty}>
          <h2>未找到这份资料</h2>
          <p>地址中的文档或分类可能已调整。</p>
          <Link href={href()}>返回帮助中心</Link>
        </section>
      ) : detail ? (
        <>
          <div className={styles.breadcrumb}>
            <Link prefetch={false} href={href({ section: location.section })}>
              ‹ 返回{helpSections.find(item => item.id === location.section)?.title}
            </Link>
          </div>
          {location.article ? (
            <ArticleDetail key={location.article.id} article={location.article} />
          ) : (
            <CrawlerDetail key={location.crawler.id} crawler={location.crawler} />
          )}
        </>
      ) : !category && !searching ? (
        <>
          <section className={styles.intro}>
            <h2>使用指南与参考资料</h2>
            <p>查阅产品口径、接入说明和全球蜘蛛资料。每项资料保留来源、复核时间与当前能力。</p>
          </section>
          <div className={styles.cards}>
            {helpSections.map(item => (
              <Link prefetch={false} key={item.id} href={href({ section: item.id })}>
                <Icon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <small>
                  {item.id === 'crawlers'
                    ? `${helpCrawlers.length} 个名称 / 控制标记`
                    : `${helpArticles.filter(article => article.section === item.id).length} 篇文档`}{' '}
                  <span aria-hidden="true">›</span>
                </small>
              </Link>
            ))}
          </div>
          <section className={styles.results} aria-label="AI 蜘蛛采集文档">
            <div className={styles.listHeader}>
              <h2>AI 蜘蛛采集</h2>
              <Link href={href({ article: 'ai-crawler-start' })}>查看接入引导</Link>
            </div>
            <ArticleList
              articles={helpArticles.filter(item =>
                [
                  'ai-crawler-start',
                  'ai-crawler-principles',
                  'ai-collection-service',
                  'ai-crawler-display',
                ].includes(item.id),
              )}
            />
          </section>
          <section className={styles.results}>
            <div className={styles.listHeader}>
              <h2>开始使用</h2>
              <span>资料复核 {HELP_REVIEWED_AT}</span>
            </div>
            <ArticleList
              articles={helpArticles.filter(item =>
                ['connect-website', 'reading-data', 'identity-check', 'robots-policy'].includes(
                  item.id,
                ),
              )}
            />
          </section>
          <section className={styles.results}>
            <div className={styles.listHeader}>
              <h2>常见问题</h2>
              <Link href={href({ section: 'faq' })}>查看全部</Link>
            </div>
            <ArticleList
              articles={helpArticles.filter(item => item.section === 'faq').slice(0, 3)}
            />
          </section>
        </>
      ) : (
        <>
          <div className={styles.listHeader}>
            <h2>{heading}</h2>
            <span role="status">
              {(category === 'crawlers' ? 0 : articles.length) +
                (!category || category === 'crawlers' ? crawlers.length : 0)}{' '}
              条结果
            </span>
          </div>
          {category === 'crawlers' && (
            <>
              <p className={styles.notice}>
                持续维护主要搜索、AI 与 SEO 蜘蛛，收录 {vendors.length} 个运营方。默认识别为{' '}
                {helpRuleCount} 个 UA 分类、{helpIdentityCount} 类 IP
                核验；各网站自定义规则以网站设置为准。
              </p>
              <div className={styles.filters}>
                <label>
                  用途
                  <select
                    aria-label="用途"
                    value={purpose}
                    onChange={event => setPurpose(event.target.value)}
                  >
                    <option value="">全部用途</option>
                    {purposes.map(item => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  运营方
                  <select
                    aria-label="运营方"
                    value={vendor}
                    onChange={event => setVendor(event.target.value)}
                  >
                    <option value="">全部运营方</option>
                    {vendors.map(item => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  类型
                  <select
                    aria-label="类型"
                    value={kind}
                    onChange={event => setKind(event.target.value)}
                  >
                    <option value="">全部类型</option>
                    <option value="crawler">HTTP 蜘蛛</option>
                    <option value="control">用途控制标记</option>
                  </select>
                </label>
                {(purpose || vendor || kind) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPurpose('');
                      setVendor('');
                      setKind('');
                    }}
                  >
                    重置筛选
                  </button>
                )}
              </div>
            </>
          )}
          {articles.length > 0 && category !== 'crawlers' && (
            <section className={styles.results} aria-label="文档结果">
              <ArticleList articles={articles} />
            </section>
          )}
          {(!category || category === 'crawlers') && crawlers.length > 0 && (
            <section className={styles.results} aria-label="蜘蛛结果">
              {searching && (
                <div className={styles.listHeader}>
                  <h3>蜘蛛目录</h3>
                </div>
              )}
              <CrawlerList crawlers={crawlers.slice(0, limit)} />
              {crawlers.length > limit && (
                <div className={styles.more}>
                  <button type="button" onClick={() => setLimit(value => value + 20)}>
                    显示更多（已显示 {limit} / {crawlers.length}）
                  </button>
                </div>
              )}
            </section>
          )}
          {((category === 'crawlers' && !crawlers.length) ||
            (category && category !== 'crawlers' && !articles.length) ||
            (!category && !articles.length && !crawlers.length)) && (
            <section className={styles.empty}>
              <h2>没有匹配的资料</h2>
              <p>尝试指标简称、厂商名称或 UA 稳定标记，也可调整筛选。</p>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setPurpose('');
                  setVendor('');
                  setKind('');
                }}
              >
                清空搜索和筛选
              </button>
            </section>
          )}
        </>
      )}
      <footer className={styles.footer}>
        资料随应用版本提供 · 官方文档优先 · IP 范围与访问策略使用前复核
      </footer>
    </div>
  );
}
