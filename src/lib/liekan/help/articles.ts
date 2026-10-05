import { HELP_REVIEWED_AT, type HelpArticle, type HelpBlock, type HelpSource } from './types';

const robotsSources: HelpSource[] = [
  {
    label: 'IETF：Robots Exclusion Protocol / RFC 9309',
    url: 'https://www.rfc-editor.org/rfc/rfc9309.html',
  },
  {
    label: 'Google：robots.txt 与索引控制',
    url: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
  },
];
const article = (
  id: string,
  section: HelpArticle['section'],
  title: string,
  summary: string,
  keywords: string[],
  blocks: HelpBlock[],
  related: string[] = [],
  sources: HelpSource[] = [],
): HelpArticle => ({
  id,
  section,
  title,
  summary,
  keywords,
  blocks,
  related,
  sources,
  reviewedAt: HELP_REVIEWED_AT,
});

export const helpGuides: HelpArticle[] = [
  article(
    'connect-website',
    'start',
    '从创建网站到收到第一条数据',
    '分别确认浏览采集、日志与内容目录，建立可用的统计范围。',
    ['接入', '安装', '网站管理', '新手'],
    [
      {
        title: '1. 添加网站',
        paragraphs: [
          '在网站管理中添加真实域名，打开网站设置中的“数据接入”。先确认当前网站与域名，再选择采集方式。独立演示站带有“示例数据”标记，适合熟悉功能。',
        ],
      },
      {
        title: '2. 安装浏览采集',
        paragraphs: [
          '从当前网站接入页复制生成的 JS 代码，添加到公共页面模板。部署后通过浏览器真实打开一页，检查网络请求与“已收到浏览数据”。浏览采集用于页面访问、来源、事件与会话。',
        ],
      },
      {
        title: '3. 接入日志',
        paragraphs: [
          '选择服务器、Cloudflare 或手动导入。服务器日志为蜘蛛统计提供 UA、路径、时间、状态码与请求方法。连接成功、收到数据、处理完成各有独立状态。',
        ],
      },
      {
        title: '4. 导入目录并配置目标',
        paragraphs: [
          '导入本站 sitemap URL 列表、CSV 或 JSON，形成覆盖率分母。再为关键页面或自定义事件配置目标；配置完成后真实触发并检查目标统计。',
        ],
      },
      {
        title: '5. 检查范围',
        paragraphs: [
          '确认网站、时区、日期和筛选条件。延后检查与完成向导记录的是接入进度；收到真实浏览访问与有效日志才提供采集证据。',
        ],
      },
    ],
    ['browser-js', 'manual-logs', 'content-catalog', 'reading-data'],
  ),
  article(
    'reading-data',
    'start',
    '理解统计范围与数据状态',
    '通过来源、窗口和状态判断数字的含义。',
    ['口径', '时区', 'available', 'empty', 'not_connected', 'estimated', 'unsupported'],
    [
      {
        title: '网站、日期和时区',
        paragraphs: [
          '指标按当前网站隔离，默认时区 Asia/Shanghai。全局日期影响卡片和表格；趋势图的 30 天、7 天、24h 为独立窗口。AI 占比使用结束日期所在月及此前 5 个自然月。今日指标按网站时区当天截至当前时间计算。',
        ],
      },
      {
        title: '状态的含义',
        paragraphs: [
          '有数据：来源已接入且当前范围有记录。暂无数据：来源可用，当前范围记录为空。待接入：必要数据来源缺失。估算：已有证据只能近似计算。未支持：当前实现或配置无法计算。缺失值保持空缺。',
        ],
      },
      {
        title: '零分母与观察边界',
        paragraphs: [
          '没有分母时，比率为无定义；有分母且分子为零时，显示真实 0%。浏览 JS 和服务器日志观察不同的访问；拦截脚本、CDN 缓存和日志缺失都可能改变观察范围。',
        ],
      },
      {
        title: '本版维护依据',
        paragraphs: [
          '本帮助词典随 Liekan 版本发布，依据仓库 docs/data-definitions.md、docs/installation.md、docs/automatic-logs.md 与实现契约维护。上游 Umami 文档提供通用概念，页面上的 Liekan 指标使用本词典给出的产品口径。',
        ],
      },
    ],
    ['no-browser-data', 'coverage-missing'],
    [{ label: 'Umami：Metric definitions', url: 'https://docs.umami.is/docs/metric-definitions' }],
  ),
  article(
    'browser-js',
    'config',
    '安装 JS 浏览采集与自定义事件',
    '使用当前网站生成的代码，确认浏览请求真正送达。',
    ['JS', 'script', 'tracker', 'PV', 'CSP', 'data-website-id', '事件'],
    [
      {
        title: '安装步骤',
        paragraphs: [
          '打开网站设置 → 数据接入 → JS 代码，复制当前网站的完整代码。公共模板应只安装一份。单页应用也应检查路由切换后的访问记录。使用接入页生成的实际地址与网站标识。',
        ],
        code: {
          label: '配置草稿 · 替换地址与网站标识',
          filename: 'liekan-tracker-draft.html',
          text: '<script defer src="https://YOUR-LIEKAN-DOMAIN/script.js"\n  data-website-id="YOUR-WEBSITE-UUID"></script>',
        },
      },
      {
        title: '验证与排障',
        paragraphs: [
          '在浏览器网络面板确认脚本加载，以及访问采集请求的响应。检查内容安全策略 CSP、广告拦截器、反向代理地址和网站 UUID。只读成员可以查看说明；改变接入进度需要网站管理权限。',
        ],
      },
      {
        title: '事件与敏感信息',
        paragraphs: [
          '通过 tracker 提供的事件接口上报业务动作，再在目标中配置事件条件。事件名称与属性应使用稳定的业务字段。避免上传邮箱、密码、密钥和个人身份信息。自定义事件独立计数，PV 排除自定义事件与性能事件。',
        ],
      },
    ],
    ['connect-website', 'no-browser-data', 'goal-config'],
    [
      {
        label: 'Umami：Track custom events',
        url: 'https://docs.umami.is/docs/track-custom-events',
      },
    ],
  ),
  article(
    'server-logs',
    'config',
    '服务器自动日志采集',
    '按接入向导生成本站专属安装命令，检查服务与处理状态。',
    ['Nginx', 'Apache', 'systemd', 'Ubuntu', 'Debian', 'collector', '采集器'],
    [
      {
        title: '适用环境',
        paragraphs: [
          '支持 Ubuntu 22/24、Debian 12、systemd、x64/arm64，采集 Nginx/Apache combined 格式的访问日志。日志必须包含 UA。先确认日志路径与当前网站对应，避免混入其他站点。',
        ],
      },
      {
        title: '安装与配对',
        paragraphs: [
          '在网站数据接入页选择“服务器”，生成一次性配对命令。配对有效期 10 分钟，每次仅可使用一次；安装账户只读取所选日志目录。命令包含本站专属凭据，应通过安全渠道操作并避免保存到公开文档。',
        ],
      },
      {
        title: '初始历史与轮转',
        paragraphs: [
          '初次安装从日志尾部开始，较早的历史日志通过手动导入补充。采用 rename/create 日志轮转；copytruncate 存在丢行边界。缓冲区上限 256 MiB 或 24 小时，检查积压与失败原因。',
        ],
      },
      {
        title: '检查连接和入库',
        paragraphs: [
          '依次检查采集器连接、最近上传、最近处理和有效记录。系统剥离 URL 查询参数与 fragment，原始 IP 仅在内存中用于核验，持久化保留网段与 HMAC。停用或更换来源前查看未处理任务。',
        ],
      },
      {
        title: '入口不可用时',
        paragraphs: [
          '自动接入需要有效 HTTPS 公网地址、签名安装资产、队列和处理进程。页面会显示实例缺少的配置；由实例管理员完成配置后重新检查。',
        ],
      },
    ],
    ['manual-logs', 'logs-not-arriving', 'deployment'],
  ),
  article(
    'cloudflare-logs',
    'config',
    'Cloudflare 日志授权与处理',
    '核对域名区域、日志权限和费用，再建立连接。',
    ['CDN', 'Cloudflare', 'OAuth', 'Logpush', 'Zone'],
    [
      {
        title: '建立授权',
        paragraphs: [
          '在网站数据接入页选择 Cloudflare，使用官方 OAuth 流程授权并核对所选 Zone 与本站域名。创建任务前确认账户套餐、Logpush 权限及可能的费用。每个网站保存一个自动日志来源。',
        ],
      },
      {
        title: '采集窗口与重复',
        paragraphs: [
          '自动来源按 UTC 窗口处理，浏览统计仍按网站时区展示。避免将同一自动采集窗口再手动导入；系统会拒绝重叠窗口。任务连接、日志送达和后台处理分别显示。',
        ],
      },
      {
        title: '配置依赖',
        paragraphs: [
          '实例需要 HTTPS 公网地址、队列、处理进程、凭据加密密钥与 Cloudflare OAuth 配置。缺失配置时入口显示原因；授权凭据不进入配置导出。',
        ],
      },
    ],
    ['logs-not-arriving', 'deployment'],
    [{ label: 'Cloudflare：Logpush', url: 'https://developers.cloudflare.com/logs/logpush/' }],
  ),
  article(
    'manual-logs',
    'config',
    '手动导入日志及格式限制',
    '上传本站日志，检查有效行、失败原因与去重边界。',
    ['combined', 'JSON', '上传', '导入', '去重', '时戳'],
    [
      {
        title: '格式与字段',
        paragraphs: [
          '支持 combined 文本与 JSON。JSON 每条记录需要时间、路径、IP 和 UA；状态、方法与响应大小按输入契约校验。时间接受有效 UTC 日期、含秒且有时区的 ISO 时间或无歧义的毫秒时间戳。路径必须属于本站，编码后上限 500 字符。',
        ],
        code: {
          label: '配置草稿 · 格式示例，使用文档保留 IP',
          filename: 'liekan-logs-draft.json',
          text: '[\n  { "time": "2026-10-05T08:00:00Z", "path": "/example",\n    "ip": "192.0.2.10", "userAgent": "ExampleBot/1.0",\n    "method": "GET", "status": 200, "bytes": 1024 }\n]',
        },
      },
      {
        title: '输入上限',
        paragraphs: [
          '每批上限 10 MiB；combined 最多 10000 行，JSON 最多 1000 条。每站点每分钟最多 5 次，同站点同一时刻仅允许一个导入事务。自动采集还有压缩 5 MiB、单行 64 KiB 和每批 1000 条限制。',
        ],
      },
      {
        title: '去重与失败行',
        paragraphs: [
          '文件摘要和请求指纹参与去重；完全相同请求的重复行保留批内次数。跨文件缺少唯一请求 ID 时，无法完全区分真实重复与重复上传，建议导出互不重叠的批次。失败记录仅保存行号与原因。',
        ],
      },
    ],
    ['server-logs', 'logs-not-arriving', 'identity-check'],
  ),
  article(
    'content-catalog',
    'config',
    '导入内容目录与覆盖率分母',
    '目录描述本站有哪些页面，并保存分类与发布时间等证据。',
    ['sitemap', 'CSV', 'JSON', '覆盖率', '结构化评分', '目录'],
    [
      {
        title: '目录输入',
        paragraphs: [
          '支持 sitemap urlset 页面 URL 列表、CSV、JSON。上传的目录文件由本实例解析；系统不会代取第三方 sitemap，也不会展开 sitemap 索引。外部 XML 实体被拒绝。URL 只接收当前网站路径。',
        ],
      },
      {
        title: '增量更新',
        paragraphs: [
          '目录按路径增量更新。未提交的元数据保留原值；显式 null 可清空可空字段。仅上传 URL 或 sitemap 会保留原有分类、发布时间和其他元数据。',
        ],
        code: {
          label: '配置草稿 · 最小目录示例',
          filename: 'liekan-catalog-draft.json',
          text: '[\n  { "url": "/guide" },\n  { "url": "/products/example" }\n]',
        },
      },
      {
        title: '指标证据',
        paragraphs: [
          '目录提供覆盖率分母。结构化评分为导入者提供的 0～100 分证据；抓取深度来自导入的链接深度；发布时间支持前后 7 天观察。未提供字段保持待接入或未观测。',
        ],
      },
    ],
    ['coverage-missing', 'metric-ai-coverage', 'metric-structure'],
  ),
  article(
    'identity-check',
    'config',
    '核验蜘蛛身份与处理未匹配请求',
    '把 UA 分类、官方范围和 DNS 证据分开判断。',
    ['IP', 'CIDR', 'IPv4', 'IPv6', 'DNS', 'PTR', '正向', '反向', '伪装', '白名单'],
    [
      {
        title: '识别步骤',
        paragraphs: [
          '先根据 UA 分类，再查该蜘蛛官方发布的 IPv4/IPv6 范围或官方身份检查方法。UA 字符串可自行填写。ASN、云服务商归属、地域和请求频率均只能辅助分析。',
        ],
      },
      {
        title: '双向 DNS 核验',
        paragraphs: [
          '对请求 IP 做反向 DNS 查询，按官方规则校验完整域名后缀与分界点，再正向解析该域名，确认地址集合包含原始 IP。只做反向解析仍缺少闭环证据。不同厂商与 crawler 类别有各自适用的域名后缀。',
        ],
      },
      {
        title: 'Liekan 当前能力',
        paragraphs: [
          '默认规则支持 13 个 UA 分类名称，6 类官方范围用于 IP 核验。核验同时要求名称、UA 与范围相符；快照距当前时间或请求时间超过 7 天时，保留未核验。范围未匹配单独展示，需检查历史时间、快照和厂商来源。自动处理进程可更新核验快照。帮助目录显示随版本附带的资料，实时核验使用实际处理时的证据。',
        ],
      },
      {
        title: '分层处理',
        paragraphs: [
          '搜索蜘蛛优先保持公开内容可访问；训练用途按内容授权目标决定 robots 策略；用户触发请求兼顾真实用户体验。对异常请求先限速并观察状态、路径与响应成本，对敏感内容使用认证、源站规则或 WAF。',
        ],
      },
    ],
    ['robots-policy', 'identity-failed'],
    [
      {
        label: 'Cloudflare：IP validation',
        url: 'https://developers.cloudflare.com/bots/reference/bot-verification/ip-validation/',
      },
      {
        label: 'Google：Verify requests',
        url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
      },
    ],
  ),
  article(
    'robots-policy',
    'config',
    'robots.txt、索引与限速策略',
    '按用途配置抓取偏好，并在源站检查实际效果。',
    ['robots.txt', 'noindex', 'Crawl-delay', 'WAF', '限速', '403', '429'],
    [
      {
        title: '抓取偏好与访问保护',
        paragraphs: [
          'robots.txt 表达抓取偏好，RFC 9309 明确它不承担访问授权。需要保护的内容应使用身份认证、权限和源站/WAF 规则。部分用户触发抓取按厂商说明可能忽略 robots；各蜘蛛对 Crawl-delay 的支持也不同。',
        ],
      },
      {
        title: '索引控制',
        paragraphs: [
          '控制索引可使用适用的 noindex 或 X-Robots-Tag。抓取被 robots 禁止后，搜索引擎可能无法读取页面上的 noindex；配置时应结合所用搜索服务的官方文档。Google-Extended、Googlebot-News、Applebot-Extended 属于用途控制标记，没有独立 HTTP UA。',
        ],
      },
      {
        title: '按用途设置草稿',
        paragraphs: [
          '以下草稿拒绝 GPTBot 与 ClaudeBot 的抓取，其他蜘蛛继续受源站既有规则约束。合并已有 robots 文件，核对所需用途后再发布到站点根路径。Liekan 保存和下载的是策略草稿，是否生效需要在源站验证。',
        ],
        code: {
          label: '配置草稿 · 合并现有文件后再部署',
          filename: 'robots-draft.txt',
          text: '# Configuration draft: review before deployment\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n',
        },
      },
      {
        title: '限速与故障恢复',
        paragraphs: [
          '将异常 UA/IP、路径和响应成本作为排查依据。429 表示限速，503 可用于临时不可用；是否退避依各厂商实现。对已核验蜘蛛设置明确的频率与敏感路径边界，定期检查是否影响搜索收录或用户请求。',
        ],
      },
    ],
    ['identity-check', 'blocked-requests'],
    robotsSources,
  ),
  article(
    'goal-config',
    'config',
    '配置目标、漏斗与转化',
    '明确目标条件与计数单位，再观察转化。',
    ['目标', 'goal', 'event', 'funnel', '转化率'],
    [
      {
        title: '目标条件',
        paragraphs: [
          '在网站的转化分析 → 目标中添加页面或事件条件。真实触发条件后检查匹配记录。重复触发的事件分别计数；同一会话命中多个目标，各目标独立统计。全站事件总次数会对重叠 event_id 去重。',
        ],
      },
      {
        title: '率与次数',
        paragraphs: [
          '转化率使用窗口内有浏览 PV 且命中目标的去重浏览会话。窗口内仅有自定义事件的访问可贡献次数，其会话不进入该窗口的浏览会话转化率。分母为零时无定义。',
        ],
      },
      {
        title: '漏斗',
        paragraphs: [
          '漏斗使用保存的步骤、时间窗口与上游匿名访客算法。先检查步骤条件与顺序。无效参数显示未支持，需修正配置后再次读取。',
        ],
      },
    ],
    ['metric-conversions', 'metric-conversion-rate', 'metric-funnel'],
  ),
  article(
    'sharing-permissions',
    'config',
    '团队、分享与访问权限',
    '使用资源归属和角色授权管理访问。',
    ['团队', '分享', '只读', '管理员', '2FA', 'API', '权限'],
    [
      {
        title: '团队与网站归属',
        paragraphs: [
          '网站归属和当前用户权限由资源元数据确定。查看与管理权限分别校验；只读角色可以查看接入说明，修改网站设置、导入数据和保存策略需要管理权限。',
        ],
      },
      {
        title: '分享与完整登录',
        paragraphs: [
          '分享页面提供已授权的公开阅读范围。完整登录后的帮助中心保持全局阅读用途；新增私有网站接口继续要求网站权限，分享令牌与 2FA 中间身份无法访问。涉及账户安全时先完成二次验证。',
        ],
      },
      {
        title: '导出',
        paragraphs: [
          '完整导出使用一致性快照，逐页读取并脱敏邮箱、凭据、IP 和访问标识；CSV 公式单元格会做保护。配置导出排除账户密钥、分享密码和原始 IP。',
        ],
      },
    ],
    ['deployment', 'reading-data'],
  ),
  article(
    'deployment',
    'config',
    '实例部署、升级与自动接入依赖',
    '检查运行版本、迁移、公开地址和后台处理能力。',
    ['Docker', 'Node', 'PostgreSQL', 'pnpm', '升级', '部署', '环境变量'],
    [
      {
        title: '运行与数据',
        paragraphs: [
          '本版使用 Node.js 22、PostgreSQL 15 与锁文件对应的依赖。部署参考仓库 docs/local-deployment.md、env.example 与 Dockerfile.liekan。升级前备份数据库，使用版本配套的增量迁移；保留已有账户、自定义凭据和角色。',
        ],
      },
      {
        title: '自动接入配置',
        paragraphs: [
          '公开接入地址使用 LIEKAN_PUBLIC_URL，要求有效 HTTPS 公网域名。服务器接入需要已签名的安装资产；Cloudflare 需要 OAuth 客户端配置；两者需要凭据加密密钥、队列与处理进程。具体环境变量依本版 env.example。密钥通过私有环境配置注入。',
        ],
      },
      {
        title: '检查与回退',
        paragraphs: [
          '检查数据库迁移、应用健康与后台任务，再执行真实访问和日志检查。帮助资料随应用版本提供，更新帮助中心无需新增数据库迁移；回退时采用兼容当前数据库的应用版本。',
        ],
      },
    ],
    ['server-logs', 'cloudflare-logs'],
  ),
  article(
    'no-browser-data',
    'faq',
    '安装后没有 PV，先检查什么？',
    '确认采集请求、网站标识和当前窗口。',
    ['PV', '没有数据', '统计为零', 'JS'],
    [
      {
        title: '逐项检查',
        paragraphs: [
          '确认所选网站 UUID 与代码一致；在真实页面检查脚本加载和采集响应；排查 CSP、拦截器、代理及缓存；确认网站时区和日期包含本次访问。自定义事件不增加 PV。示例数据无法证明实际脚本运行。',
        ],
      },
    ],
    ['browser-js', 'reading-data', 'metric-pv'],
  ),
  article(
    'coverage-missing',
    'faq',
    '有 AI 请求，覆盖率仍显示待接入',
    '检查目录是否为空，以及日志路径是否能与目录匹配。',
    ['覆盖率', '分母', '待接入', 'URL'],
    [
      {
        title: '检查目录与路径',
        paragraphs: [
          '覆盖率需要已导入的本站内容目录。先确认目录 URL 数量；再检查日志与目录的路径、编码及网站归属。指标只统计被 AI 请求命中的目录内 URL，目录外请求仍计入 AI 请求量。',
        ],
      },
    ],
    ['content-catalog', 'metric-ai-coverage'],
  ),
  article(
    'identity-failed',
    'faq',
    'UA 命中，IP 为什么仍未核验？',
    '查阅当前能力、快照时间与适用范围。',
    ['IP', '未核验', '范围未匹配', 'unverified', 'range_mismatch'],
    [
      {
        title: '排查顺序',
        paragraphs: [
          '在目录详情确认本版是否支持该名称的 IP 核验。检查请求时间与快照时间，超出 7 天保留未核验。确认来源类别与 IPv4/IPv6 支持。官方范围未匹配时再做官方工具或双向 DNS 检查，保留独立证据。',
        ],
      },
    ],
    ['identity-check', 'metric-identity'],
  ),
  article(
    'blocked-requests',
    'faq',
    '蜘蛛持续出现 403 或 429',
    '检查访问策略、限速规则与源站成本。',
    ['403', '429', 'WAF', 'robots', 'blocked'],
    [
      {
        title: '定位响应来源',
        paragraphs: [
          '区分 CDN、WAF 与源站生成的状态码。按路径、UA、IP 核验结果和请求时间检查命中的规则。公开搜索内容可对已核验蜘蛛设置合理频率；训练用途按内容策略控制。先观察调整后的日志再扩大范围。',
        ],
      },
    ],
    ['robots-policy', 'identity-check'],
  ),
  article(
    'repeated-crawl',
    'faq',
    '反复抓取与完成率如何理解？',
    '高频请求需要结合路径和响应分析。',
    ['重复', '反复', '完成率', '50'],
    [
      {
        title: '反复与重复',
        paragraphs: [
          '反复抓取指当前窗口同一 URL 达到 50 次 AI 请求。重复导入、变化频繁的页面、失败重试和合法刷新都可能出现高频记录。检查导入批次、状态码与时间分布。普通日志无法证明正文完整接收，抓取完成率保持未提供。',
        ],
      },
    ],
    ['metric-repeat', 'metric-completion', 'manual-logs'],
  ),
  article(
    'logs-not-arriving',
    'faq',
    '来源已连接，日志仍未出现',
    '分别检查上传、队列与处理，不同阶段有独立证据。',
    ['服务器', 'Cloudflare', '处理失败', '日志', 'queue'],
    [
      {
        title: '检查数据链路',
        paragraphs: [
          '确认源站日志确实写入；检查采集路径、权限、轮转方式和最近上传；查看后台队列及处理进程状态；检查有效行数与失败原因。只有连接成功的来源可能尚未上传，收到批次后也可能等待处理。',
        ],
      },
    ],
    ['server-logs', 'cloudflare-logs', 'manual-logs'],
  ),
  article(
    'policy-not-live',
    'faq',
    '保存 robots 或白名单后仍有请求',
    '将草稿部署到源站，再查官方读取与实际访问。',
    ['白名单', 'robots', '生效', '下载', '配置'],
    [
      {
        title: '验证部署',
        paragraphs: [
          'Liekan 生成、保存和下载配置草稿。将审核后的规则部署到源站根路径或 WAF，再检查公开 robots.txt、缓存与源站规则命中。各厂商重新读取 robots 的时间不同，部分用户触发请求可能忽略该文件。',
        ],
      },
    ],
    ['robots-policy', 'identity-check'],
  ),
];
