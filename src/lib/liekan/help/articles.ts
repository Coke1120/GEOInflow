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
  setupGuide: [
    'ai-crawler-start',
    'ai-collection-service',
    'ai-crawler-display',
    'server-logs',
    'cloudflare-logs',
    'manual-logs',
  ].includes(id),
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
          '本帮助词典随猎看统计版本发布，依据产品的数据定义、数据接入说明与实际计算规则维护。各指标的计算方法、数据来源、统计窗口和边界均可在指标词典中查阅。',
        ],
      },
    ],
    ['no-browser-data', 'coverage-missing'],
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
  ),
  article(
    'ai-crawler-start',
    'start',
    '配置并验证 AI 蜘蛛采集',
    '选择网站与日志来源，按接入引导完成配置，再核对真实请求。',
    ['AI 蜘蛛', '采集', '接入', '配置', '引导', '入门', '验证'],
    [
      {
        title: '1. 选择网站并打开数据接入',
        paragraphs: [
          '在网站管理中找到目标网站，点击“网站设置”，打开“数据接入”，进入“接入 AI 蜘蛛日志”。添加新网站时也可沿接入向导进入日志步骤。配置和连接需要该网站的管理权限。',
        ],
      },
      {
        title: '2. 按观察范围选择日志来源',
        paragraphs: [
          '网站经过 Cloudflare 代理且账户支持所需 Logpush 能力时，选择“Cloudflare 授权连接”，观察 CDN 边缘请求。能管理源站 Linux 服务器时，选择“服务器一次安装”，读取本站 Nginx 或 Apache 日志。已有历史日志或暂不配置自动采集时，选择“手动导入日志”。',
          'CDN 缓存命中和边缘拦截通常不会到达源站。服务器日志与 CDN 日志覆盖的请求范围会不同；每个网站只保留一个主要自动来源，避免重复叠加相同时段的日志。',
        ],
      },
      {
        title: '3. 根据页面状态完成配置',
        paragraphs: [
          '显示“待配置”时，点击“开始配置”或“查看配置说明”，让部署管理员按页面逐项准备公网 HTTPS 地址、日志队列、处理服务及对应接入资产；完成后点击“重新检查”。显示“可用”后，服务器方式生成本站专属配对命令，Cloudflare 方式按页面授权并确认匹配域名与费用。',
          '手动方式使用本站真实日志，先核对字段、时区与导入时间范围，再查看有效行数和失败原因。跳过检查或完成向导仅保存设置进度。',
        ],
      },
      {
        title: '4. 分别验证接收、处理和识别',
        paragraphs: [
          '先用浏览器真实访问本站一页，确认对应源站或 CDN 日志中出现请求。回到接入检查，依次核对连接状态、最近上传、最近处理、有效日志条数与积压。普通浏览请求可以验证日志链路；AI 蜘蛛匹配需要实际出现符合识别规则的请求。',
          '在该网站日志中查看请求时间、路径、UA 分类、身份核验和状态码，再进入 AI 抓取分析核对所选日期。自行填写蜘蛛 UA 的测试请求只能测试分类，IP 身份核验仍需真实厂商来源。已有日志且暂未匹配 AI 请求时，保持实际结果。',
        ],
      },
      {
        title: '5. 检查展示开关与内容目录',
        paragraphs: [
          '若 AI 抓取菜单显示关闭，进入“网站设置 → 基本设置 → 数据展示”，开启“AI 蜘蛛数据展示”。该开关控制页面展示，日志采集依原配置运行。抓取覆盖率还需要导入本站内容目录；仅接入日志可先查看 AI 请求数量、路径与状态。',
        ],
      },
    ],
    [
      'ai-crawler-principles',
      'ai-collection-service',
      'server-logs',
      'cloudflare-logs',
      'manual-logs',
      'ai-crawler-display',
      'content-catalog',
      'logs-not-arriving',
    ],
  ),
  article(
    'ai-crawler-principles',
    'config',
    'AI 蜘蛛采集与识别原理',
    '了解请求日志如何转成蜘蛛统计，以及分类、身份核验和覆盖率的边界。',
    ['AI 蜘蛛', '采集原理', '日志', 'UA', 'IP', '训练', 'AI 搜索', '用户触发'],
    [
      {
        title: '请求如何成为统计数据',
        paragraphs: [
          'AI 蜘蛛访问网站 → 源站或 CDN 记录请求 → 采集器上传、CDN 推送或手动导入 → 校验网站归属、格式、时间与重复 → 按 UA 分类并核验来源 → 处理完成后进入网站日志和统计报表。',
          '浏览 JS 记录执行脚本的页面访问。蜘蛛请求通过服务器或 CDN 日志观察，包含时间、路径、客户端 IP、User-Agent、方法、状态码及响应大小等字段。采集过程中移除路径查询参数，原始 IP 用于核验后按产品规则脱敏保存。',
        ],
      },
      {
        title: '按用途理解 AI 请求',
        paragraphs: [
          '训练抓取、AI 搜索与用户触发访问分别分类。例如 GPTBot 面向模型改进，OAI-SearchBot 面向搜索，ChatGPT-User 对应用户发起的访问。用途与厂商官方说明、本站规则和记录时间一起核对。AI 搜索带来的真人访问通过浏览来源观察。',
        ],
      },
      {
        title: 'UA 分类与 IP 身份核验',
        paragraphs: [
          'UA 用于匹配蜘蛛名称与用途，请求者可以自行填写这一字符串。身份核验还需要名称、UA 和对应厂商官方 IP 范围相符，且快照与请求时间处于有效范围。没有支持的官方范围、范围未匹配或证据过期时，保留未核验状态。',
          '帮助目录收录的名称多于当前默认识别规则。各条目注明本版分类与 IP 核验能力；新增参考资料不会自动新增服务器端识别。Google-Extended 等用途控制标记没有独立 HTTP 蜘蛛 UA 或 IP。',
        ],
      },
      {
        title: '接收确认与统计完成',
        paragraphs: [
          '自动来源收到持久确认后，批次已保存并进入后台处理。处理服务继续完成分类、去重和入库，来源页面单独显示最近处理、积压与失败。确认接收后，仍需核对处理完成和有效记录。',
          '每个网站使用一个主要自动来源及其生效时段。批次标识、请求特征与导入台账帮助去重；手动导入会检查与自动来源的时间重叠。',
        ],
      },
      {
        title: '统计能说明什么',
        paragraphs: [
          '日志证明观察范围内发生了请求及对应响应状态。200、403、429 和失败重试均需按实际记录分析。AI 请求数量与目录命中可以说明抓取活动；普通日志缺少正文完整接收、模型训练采用或 AI 回答引用的证据。',
          '覆盖率以已导入本站内容目录为分母。源站日志遗漏 CDN 缓存命中、日志字段缺失、采样和观察窗口都会影响结果。robots 策略与源站/WAF 限制决定访问处理，统计采集依赖实际送达的日志。',
        ],
      },
    ],
    [
      'ai-crawler-start',
      'identity-check',
      'metric-ai-requests',
      'metric-ai-coverage',
      'robots-policy',
    ],
    [
      {
        label: 'OpenAI：官方蜘蛛用途与 IP 范围',
        url: 'https://developers.openai.com/api/docs/bots',
      },
      {
        label: 'Google：验证爬虫与获取器请求',
        url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
      },
      {
        label: 'Cloudflare：HTTP 请求日志字段',
        url: 'https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/',
      },
    ],
  ),
  article(
    'ai-collection-service',
    'config',
    '配置 AI 蜘蛛日志接收服务',
    '供部署管理员准备自动接入依赖，并指导网站管理员完成连接。',
    ['AI 蜘蛛', '采集配置', 'HTTPS', 'LIEKAN_PUBLIC_URL', 'queue', 'worker', 'OAuth', '签名安装包'],
    [
      {
        title: '先使用接入页面的逐项检查',
        paragraphs: [
          '在目标网站的“数据接入”中选择服务器或 Cloudflare，打开配置说明。页面按接入方式显示公网 HTTPS 地址、日志队列、日志处理服务、采集器部署包、Cloudflare 授权应用与凭据加密密钥的检查结果。将待配置项交给部署管理员，完成后重新检查。',
        ],
      },
      {
        title: '两种自动方式共用的配置',
        paragraphs: [
          'LIEKAN_PUBLIC_URL 填写统计服务对外的 HTTPS 根地址，例如 https://stats.example.com；网站设置页使用同一域名。准备日志队列并持续运行日志处理服务，确认近期心跳。LIEKAN_LOG_CREDENTIALS_KEY 使用 32 字节随机密钥的 Base64，应用与处理服务采用同一私有配置。',
          '本地 127.0.0.1 地址可以阅读和测试统计页面。对外服务器和 CDN 接入需要页面检查通过的公网 HTTPS 地址。配置说明中的示例值需替换后应用到部署环境，保存说明不会修改实例的运行配置。',
        ],
      },
      {
        title: '服务器方式的额外准备',
        paragraphs: [
          '平台需要提供已签名的 Docker 部署包或 Linux x64/arm64 直接安装资产。部署管理员使用受控签名密钥生成安装资产并部署应用镜像。宝塔用户优先使用 Docker；检查通过后在网站服务器运行安装命令。配对码有效期十分钟且仅可使用一次。',
        ],
      },
      {
        title: 'Cloudflare 方式的额外准备',
        paragraphs: [
          '部署管理员配置 CLOUDFLARE_OAUTH_CLIENT_ID 和 CLOUDFLARE_OAUTH_CLIENT_SECRET，在 Cloudflare 登记本实例的 OAuth 应用。回调为公网根地址加 /api/liekan/oauth/cloudflare/callback。密钥保留在私有部署配置中。',
          '网站管理员按官方授权流程连接账户，核对与本站域名匹配的 Zone、Logpush 权限、账户能力及费用后确认。平台负责建立对应推送任务，返回后检查连接与真实日志到达。',
        ],
      },
      {
        title: '重新检查与验收',
        paragraphs: [
          '应用配置并确认处理服务运行后，回到原接入页点击“重新检查”。能力检查通过后继续授权或安装，再查看最近接收、最近处理、有效条数与错误信息。公网连通性和日志实际到达需要在连接后验证。',
        ],
      },
    ],
    ['ai-crawler-start', 'deployment', 'server-logs', 'cloudflare-logs', 'logs-not-arriving'],
    [
      {
        label: 'Cloudflare：创建 OAuth 客户端',
        url: 'https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/',
      },
    ],
  ),
  article(
    'ai-crawler-display',
    'config',
    'AI 蜘蛛数据展示与采集状态',
    '了解展示开关、日志接入进度和历史统计各自控制的内容。',
    ['AI 蜘蛛', '数据展示', '关闭', '开启', '采集开关', '只看访客', '菜单'],
    [
      {
        title: '开启或关闭数据展示',
        paragraphs: [
          '进入“网站设置 → 基本设置 → 数据展示”，调整“AI 蜘蛛数据展示”。默认开启，需要网站管理权限。关闭后隐藏 AI 抓取分析入口和相关蜘蛛指标，总览显示访客统计；当前报表导出与公开分享遵循同一展示选择。',
        ],
      },
      {
        title: '日志来源继续按原配置运行',
        paragraphs: [
          '关闭展示会保留历史数据、日志采集、识别规则和安装配置，重新开启即可查看既有记录。需要暂停采集或断开来源时，在“数据接入 → 日志接入设置”中对相应来源操作；服务器采集器的本机卸载按服务器文档执行。',
        ],
      },
      {
        title: '进度与真实数据分别判断',
        paragraphs: [
          '跳过检查、完成设置和收到新日志均保持用户保存的展示选择。示例日志不能证明真实接入；真实日志收到后继续检查处理结果和 AI 匹配。AI 搜索带来的真人访问仍计入访客来源。',
        ],
      },
    ],
    ['ai-crawler-start', 'server-logs', 'cloudflare-logs', 'logs-not-arriving'],
  ),
  article(
    'server-logs',
    'config',
    '服务器自动日志采集',
    '按接入向导生成本站专属安装命令，检查服务与处理状态。',
    ['Nginx', 'Apache', 'Docker', '宝塔', 'systemd', 'Ubuntu', 'Debian', 'collector', '采集器'],
    [
      {
        title: '适用环境',
        paragraphs: [
          '推荐 Docker / 宝塔方式：Linux x64/arm64、可用的 Docker 和 Compose V2；运行环境随部署包封装。直接安装支持 Ubuntu 22.04/24.04、Debian 12 和 systemd。采集 Nginx / Apache Combined 日志，需包含 User-Agent 并对应当前网站。',
        ],
      },
      {
        title: '准备本站访问日志',
        paragraphs: [
          '使用本站独立的 combined 访问日志，保留客户端地址、请求时间、方法、路径、状态、响应大小和 User-Agent。Nginx 可使用内置 combined 格式，Apache 可使用 CustomLog 的 combined 格式。已有日志配置由服务器管理员核对后合并。',
          '示例片段放入对应 Nginx server 配置，替换路径并先检查配置，再重新加载服务。站点经过反向代理或 CDN 时，还需由管理员按可信代理来源配置真实客户端地址；直接记录代理节点地址会影响蜘蛛身份核验。',
        ],
        code: {
          label: '配置草稿 · 合并到本站 Nginx server，替换日志路径',
          filename: 'liekan-nginx-access-log-draft.conf',
          text: '# Review and merge into the existing site server block\naccess_log /var/log/nginx/YOUR-SITE.access.log combined;\n',
        },
      },
      {
        title: '安装与配对',
        paragraphs: [
          '在网站数据接入页选择“服务器”，默认使用 Docker。可生成安装命令在宝塔终端执行，或下载部署包并上传到公开访问目录之外，解压后运行 start.sh。安装先检查日志、容器和网络，再使用十分钟有效的一次性配对码。下载包不含配对码或长期凭据；配对完成后只读采集所选网站日志。宝塔访问日志通常位于 /www/wwwlogs/，具体路径请在网站日志设置中核对。',
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
    [
      {
        label: 'Nginx：访问日志与 combined 格式',
        url: 'https://nginx.org/en/docs/http/ngx_http_log_module.html',
      },
      { label: 'Apache：访问日志配置', url: 'https://httpd.apache.org/docs/2.4/logs.html' },
    ],
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
        title: '核对推送范围与日志字段',
        paragraphs: [
          '本版自动接入使用 HTTP 请求日志，筛选本站域名的 eyeball 请求，覆盖缓存命中、静态资源及有效拦截请求。字段包括时间、主机、路径、客户端 IP、User-Agent、方法、响应状态与 Ray ID 等，按接入配置核对有效和拒绝条数。',
          '平台使用完整采样率与 rfc3339ns 时间输出，保留高精度时间用于去重。原生 CDN 日志需要通过自动接入或转换成受支持的手动格式，直接上传任意供应商日志可能产生字段错误。',
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
    [
      { label: 'Cloudflare：Logpush', url: 'https://developers.cloudflare.com/logs/logpush/' },
      {
        label: 'Cloudflare：HTTP 请求日志字段',
        url: 'https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/',
      },
      {
        label: 'Cloudflare：日志输出选项',
        url: 'https://developers.cloudflare.com/logs/logpush/logpush-job/log-output-options/',
      },
    ],
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
