/* Liekan AI interaction prototype. All analysis and connection results are demonstrations. */
(() => {
  const root = document.querySelector('#app'), page = document.body.dataset.page;
  const params = new URLSearchParams(location.search), scenes = {unconfigured:'未配置 API',ready:'已配置 · 首页',conversation:'分析对话示例',empty:'当前范围无数据',partial:'数据不足',error:'AI 服务失败',viewer:'成员无配置权限'};
  let scene = Object.hasOwn(scenes, params.get('scene')) ? params.get('scene') : page==='config'?'ready':'unconfigured';
  let site = params.get('site') === 'official' ? 'official' : 'demo', period = ['7','30'].includes(params.get('period')) ? params.get('period') : '7';
  let configured = scene !== 'unconfigured', turnRun = 0, messages = [], lastQuestion = '', toastTimer;
  const sites = {demo:'Liekan 演示站',official:'猎看官网'}, ranges = {'7':'2026-09-28 至 10-04','30':'2026-09-05 至 10-04'};
  const iconPaths = {
    spark:'<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
    bars:'<path d="M4 20V10M10 20V4M16 20v-8M22 20V7"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    share:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V3H3v13h5"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 6"/>',
    chat:'<path d="M21 12a9 9 0 0 1-9 9H3l2-4a9 9 0 1 1 16-5Z"/>',
    settings:'<path d="m10 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1Z"/><circle cx="12" cy="12" r="3"/>',
    arrow:'<path d="M12 19V5M5 12l7-7 7 7"/>',plus:'<path d="M12 5v14M5 12h14"/>',
    right:'<path d="m9 5 7 7-7 7"/>',back:'<path d="m12 5-7 7 7 7M5 12h15"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h5"/>',
    link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
    key:'<circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 9-9M16 7l3 3M19 4l3 3"/>',
    eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    check:'<path d="m5 12 4 4L19 6"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>'
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.grid}</svg>`;
  const button = (text, action, primary = false, attrs = '') => `<button type="button" class="button ${primary ? 'primary' : ''}" data-action="${action}" ${attrs}>${text}</button>`;
  function url(target = 'chat', extra = {}) {const query = new URLSearchParams({scene,site,period,...extra});return `${target === 'config' ? 'ai-config' : 'ai-chat'}.html?${query}`;}
  const viewLink = (title, view, name = 'right', cls = 'button') => `<a class="${cls}" href="${url('chat',{view})}">${icon(name)}${title}</a>`;
  const configLink = (text = '前往配置 API', cls = 'button primary') => `<a class="${cls}" href="${url('config')}">${icon('settings')}${text}</a>`;
  function updateUrl() {params.set('scene',scene);params.set('site',site);params.set('period',period);const current=new URLSearchParams(location.search);for(const key of ['scene','site','period'])current.set(key,params.get(key));if(page==='chat'&&!params.has('view'))current.delete('view');history.replaceState(null,'',`${location.pathname}?${current}`);}
  function toast(text) {document.querySelector('.toast')?.remove();clearTimeout(toastTimer);const el=document.createElement('div');el.className='toast';el.role='status';el.textContent=text;document.body.append(el);toastTimer=setTimeout(()=>el.remove(),3500);}
  function sidebar() {
    const item=(label,name,view)=>`<a class="nav-item ${params.get('view')===view?'on':''}" href="${url('chat',{view})}">${icon(name)}${label}</a>`;
    return `<aside class="sidebar" id="sidebar"><a class="brand" href="${url('chat')}"><img src="../liekan-ui-v1/assets/logo.svg" width="32" height="32" alt=""><span class="brand-name">猎看统计<span class="brand-caption">LIEKAN GEO STATS</span></span></a><nav class="nav" aria-label="全局管理"><a class="nav-item nav-quick ${page==='chat'&&!params.has('view')?'on':''}" href="${url('chat')}" ${page==='chat'&&!params.has('view')?'aria-current="page"':''}>${icon('spark')}快速发起</a>${item('数据总览','grid','dashboard')}<div class="nav-label">数据管理</div>${item('网站管理','globe','websites')}${item('数据看板','bars','boards')}${item('追踪管理','target','tracking')}<div class="nav-label">协作管理</div>${item('分享管理','share','sharing')}${item('团队管理','users','teams')}<div class="nav-label">AI 能力</div><a class="nav-item ${page==='config'?'on':''}" href="${url('config')}" ${page==='config'?'aria-current="page"':''}>${icon('settings')}AI配置器</a></nav><footer class="side-footer"><span class="avatar">LK</span><span><strong class="small">${scene==='viewer'?'团队成员':'admin'}</strong><span class="muted small" style="display:block">个人空间 · 原型</span></span><a class="icon-button" href="${url('config')}" aria-label="打开 AI配置器">${icon('settings')}</a></footer></aside><button type="button" class="backdrop" data-action="close-nav" aria-label="关闭菜单"></button>`;
  }
  function shell(content) {
    const title=page==='config'?'AI配置器':params.has('view')?'后台入口预览':'快速发起';
    root.innerHTML=`<a class="skip" href="#main-content">跳到主要内容</a>${sidebar()}<div class="shell"><header class="header"><div class="header-title"><button class="icon-button mobile-menu" data-action="menu" aria-label="打开菜单" aria-expanded="false" aria-controls="sidebar">${icon('menu')}</button><span class="blue">${icon('spark')}</span>${title}</div><div class="actions">${page==='chat'&&!params.has('view')?button(icon('plus')+'新对话','new'): `<a class="button" href="${url('chat')}">${icon('back')}返回对话</a>`}<a class="icon-button" href="${url('config')}" aria-label="AI 配置">${icon('settings')}</a></div></header><div class="review-bar"><span class="badge">交互原型</span><span class="review-description">示例数据 · API 连接与回答均为模拟</span><label>预览状态<select id="scene" aria-label="预览状态">${Object.entries(scenes).map(([key,title])=>`<option value="${key}" ${scene===key?'selected':''}>${title}</option>`).join('')}</select></label></div><main id="main-content" tabindex="-1">${content}</main></div>`;
  }
  function scope() {return `<div class="scope"><label>${icon('globe')}<span class="sr-only">分析网站</span><select id="site" aria-label="分析网站"><option value="demo" ${site==='demo'?'selected':''}>Liekan 演示站（示例数据）</option><option value="official" ${site==='official'?'selected':''}>猎看官网（未接入数据）</option></select></label><label>${icon('clock')}<span class="sr-only">统计时间</span><select id="period" aria-label="统计时间"><option value="7" ${period==='7'?'selected':''}>最近 7 天</option><option value="30" ${period==='30'?'selected':''}>最近 30 天</option></select></label><span class="badge ${configured?'green':'gray'} status"><span class="dot"></span>${configured?'演示模型已就绪':'尚未配置 API'}</span></div>`;}
  function composer(followup = false) {return `<form class="composer" id="ask-form"><label class="sr-only" for="question">${followup?'继续提问':'向 AI 提问'}</label><textarea id="question" maxlength="2000" rows="${followup?2:3}" placeholder="${followup?'继续追问，或让 AI 帮你定位相关页面…':'例如：本周 AI 抓取为什么下降？哪些页面值得优先优化？'}"></textarea><div class="composer-actions"><button type="button" class="icon-button" data-action="context" aria-label="查看当前分析的数据范围">${icon('plus')}</button><span class="blue">${icon('spark')}</span><button type="button" class="chip" data-prompt="分析当前网站的 AI 流量表现">${icon('bars')}洞察分析</button><button type="button" class="chip" data-prompt="生成当前网站的分析摘要与下周建议">${icon('file')}生成分析摘要</button><button type="submit" class="send" aria-label="发送提问">${icon('arrow')}</button></div></form>`;}
  function landing() {
    const shortcuts=[['AI 抓取分析','crawls','bars'],['AI 引荐分析','referrals','link'],['日志访问流','logs','file'],['页面与事件','pages','grid'],['转化分析','conversions','target']];
    return `<section class="welcome"><h1>${configured?'今天想问什么，猎看团队？':'让 AI 帮你读懂网站数据'}</h1><p>问指标、查趋势、定位异常，回答后可直达相关页面</p>${composer()}${!configured?`<div class="connect-hint"><span class="hint-icon">${icon('key')}</span><div><strong>连接你的 AI，开始个性化分析</strong><p>配置 API 后，结合授权网站的日志、流量与转化数据回答。</p></div>${configLink()}</div>`:''}</section><section class="shortcuts"><div class="section-heading"><h2>常用功能</h2><span class="small muted">分析有依据，建议有入口</span></div><div class="function-grid">${shortcuts.map(([title,view,name])=>viewLink(title,view,name,'function-link')).join('')}<button class="function-link" data-action="example">${icon('chat')}查看对话示例</button></div></section><section class="tool-zone"><div><h2>后台数据一站直达 <span class="faint">${icon('right')}</span></h2><p>从一条分析建议，继续查看日志、页面和转化明细</p><div class="tool-chips">${[['网站管理','websites'],['AI 爬虫','bots'],['抓取页面','crawls'],['来源渠道','referrals'],['数据看板','boards'],['日志访问流','logs']].map(([t,v])=>viewLink(t,v,'right','')).join('')}</div></div><div class="guide"><h3><span class="dot blue"></span>一次提问，清晰指引</h3><div class="guide-grid"><span>理解问题</span><span>检索指标</span><span>引用依据</span><span>定位页面</span></div></div></section><p class="footnote">原型中所有数字与回答均为示例。实际分析仅使用你有权限的网站数据。</p>`;
  }
  const datasets = {
    crawls:{title:'AI 抓取分析',headers:['AI 爬虫','本期抓取','前期抓取','本期失败','前期失败'],rows:[['GPTBot','1,246','2,086','420','56'],['ClaudeBot','862','891','23','18'],['其他 AI 爬虫','1,734','1,845','41','27']],numeric:[1,2,3,4]},
    logs:{title:'日志访问流',headers:['时间 · Asia/Shanghai','AI 爬虫','页面路径','HTTP 状态'],rows:[['10-04 09:42','GPTBot','/guide/geo','403'],['10-04 09:38','GPTBot','/blog/ai-search','403'],['10-04 09:31','ClaudeBot','/pricing','200']],numeric:[3]},
    referrals:{title:'AI 引荐分析',headers:['来源','访客','转化','转化率'],rows:[['chatgpt.com','846','28','3.3%'],['perplexity.ai','521','19','3.6%'],['其他 AI 来源','189','6','3.2%']],numeric:[1,2,3]},
    pages:{title:'页面与事件',headers:['页面路径','访问量','AI 引荐访客','转化次数'],rows:[['/guide/geo','2,184','418','17'],['/blog/ai-search','1,672','326','12'],['/pricing','938','291','24']],numeric:[1,2,3]},
    conversions:{title:'转化分析',headers:['转化事件','AI 引荐转化','全部转化','备注'],rows:[['demo_submit','36','84','已定义事件'],['signup','17','69','已定义事件']],numeric:[1,2]},
    bots:{title:'AI 爬虫',headers:['爬虫名称','用途','本期抓取','识别依据'],rows:[['GPTBot','模型训练抓取','1,246','User-Agent 规则'],['ClaudeBot','模型训练抓取','862','User-Agent 规则']],numeric:[2]}
  };
  function table(data) {return `<div class="table-wrap"><table><thead><tr>${data.headers.map((h,i)=>`<th scope="col" class="${data.numeric.includes(i)?'numeric':''}">${h}</th>`).join('')}</tr></thead><tbody>${data.rows.map(row=>`<tr>${row.map((v,i)=>`<td class="${data.numeric.includes(i)?'numeric':''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="table-caption">${esc(sites[site])} · ${ranges['7']} · 示例数据 · 时区 Asia/Shanghai</p>`;}
  function condition() {return site==='official'||scene==='empty'?'empty':period==='30'||scene==='partial'?'partial':scene==='error'?'error':'normal';}
  function answer(question) {
    const state=condition();
    if(state==='empty')return `<h2>当前范围没有可用于分析的数据</h2><p class="answer-text">${esc(sites[site])}在所选期间没有已接入的统计记录。请先检查数据接入，收到首条记录后再分析趋势。</p><div class="data-links">${viewLink('检查网站接入','websites','globe')}${viewLink('查看日志访问流','logs','file')}</div>`;
    if(state==='partial')return `<h2>当前数据不足以判断长期趋势</h2><p class="answer-text">这份演示仅提供最近 7 天及其前 7 天对照。${period==='30'?'所选最近 30 天缺少完整记录':'当前预览缺少完整日志'}，无法给出所选范围的可靠变化率或原因。</p><p class="answer-text">可以先查看现有明细，并补齐数据后继续分析。AI 抓取日志无法直接判断品牌提及率、回答排名或真实引用情况，这些指标需要接入 AI 回答监测数据。</p><div class="data-links">${viewLink('查看已有数据','crawls','bars')}${button('切换最近 7 天','use-seven',true)}</div>`;
    if(state==='error')return `<h2>AI 服务暂时无法完成分析</h2><p class="answer-text">演示服务返回超时。你的问题已保留，可重试，或到 AI配置器检查连接。网站统计仍可通过下方入口查看。</p><div class="data-links">${button('重试分析','retry',true)}${configLink('检查 AI 配置','button')}${viewLink('查看统计明细','crawls','bars')}</div>`;
    if(/提及|排名|引用率|Top\s*3|竞品/i.test(question))return `<h2>这项分析需要 AI 回答监测数据</h2><p class="answer-text">当前可用数据包含抓取日志、AI 引荐、页面访问与转化记录。品牌提及率、回答排名和引用率需要对应的 AI 回答样本及监测结果。</p><p class="answer-text">可以先分析 AI 是否抓取你的内容，以及来自 AI 平台的访问与转化。</p><div class="data-links">${viewLink('查看 AI 抓取','crawls','bars')}${viewLink('查看 AI 引荐','referrals','link')}</div>`;
    if(/页面.*优化|哪些页面|优化.*页面/.test(question)&&!/抓取/.test(question))return `<h2>优先优化指南页与定价页</h2><p class="answer-text">/guide/geo 带来 418 位 AI 引荐访客，产生 17 次转化；/pricing 带来 291 位访客，产生 24 次转化。指南页可以加强内容到咨询的衔接，定价页可以完善用户决策所需的信息。</p><ol class="recommendations"><li><strong>/guide/geo</strong>：补齐具体问题、可核验依据和下一步咨询入口。</li><li><strong>/pricing</strong>：写清服务范围、适用场景与常见问题，继续观察转化变化。</li></ol><p class="notice">这是基于示例访问与转化记录的优化方向，尚未核对页面内容与真实用户反馈。</p><div class="data-links">${viewLink('查看页面与事件','pages','grid')}${viewLink('查看转化分析','conversions','target')}</div><details class="evidence"><summary>查看页面依据 · 3 个页面 · 示例数据</summary>${table(datasets.pages)}</details>`;
    const referrals=/引荐|来源|转化/.test(question), summary=/摘要|周报|建议/.test(question);
    return `<h2>${referrals?'AI 引荐带来了 1,556 位访客，转化率为 3.4%':summary?'本周重点：排查抓取受阻，改善引荐落地页':'AI 抓取下降 20.3%，优先检查 GPTBot 的访问限制'}</h2><p class="answer-text">${referrals?'本期 AI 引荐产生 53 次转化。ChatGPT 带来 846 位访客，Perplexity 的转化率为 3.6%。这些记录可以帮助你比较来源质量。':'本期抓取从 4,822 次降至 3,842 次。GPTBot 减少 840 次，贡献了总减少量的 85.7%。'}<button type="button" class="button text small" data-action="evidence">[1]</button></p><div class="metric-row">${(referrals?[['AI 引荐访客','1,556','按网站统计'],['AI 引荐转化','53','按事件统计'],['引荐转化率','3.4%','53 ÷ 1,556']]:[['AI 抓取','3,842','较前期下降 20.3%'],['GPTBot 抓取','1,246','较前期下降 40.3%'],['抓取失败率','12.6%','前期 2.1%']]).map(([t,v,n])=>`<div><span class="small muted">${t}</span><strong class="num">${v}</strong><small>${n}</small></div>`).join('')}</div><h2>建议先做这两件事</h2><ol class="recommendations"><li><strong>${referrals?'优化 AI 引荐的落地页':'核对 GPTBot 抓取失败记录'}</strong>。${referrals?'对照 /guide/geo 与 /pricing 的访问和转化，检查内容与咨询入口是否衔接。':'日志出现 HTTP 403。请核对 CDN / WAF 与 robots.txt，验证访问限制。'}</li><li><strong>${referrals?'对照来源质量，继续观察转化':'检查高价值内容的抓取覆盖'}</strong>。${referrals?'优先比较不同来源的转化事件，避免仅按访客量分配投入。':'先排查 /guide/geo 与 /blog/ai-search，修复后观察下一周期变化。'}</li></ol><p class="notice">${referrals?'统计记录支持来源与转化对照；样本较小，结果需要持续观察。':'日志支持“抓取受阻”的排查方向，现有证据不足以确认因果。AI 抓取次数与品牌提及、排名分别需要对应数据。'}</p><div class="data-links">${referrals?viewLink('查看 AI 引荐','referrals','link'):viewLink('查看日志访问流','logs','file')}${viewLink('查看抓取页面','crawls','bars')}${viewLink('查看转化分析','conversions','target')}</div><details class="evidence" id="answer-evidence"><summary>[1] 查看数据依据 · ${referrals?'3 个来源':'3 类 AI 爬虫'} · 示例记录</summary>${table(referrals?datasets.referrals:datasets.crawls)}</details><div class="message-actions"><button type="button" data-action="copy">${icon('copy')}复制分析</button><button type="button" data-action="summary">${icon('file')}生成摘要</button><span class="small muted">建议需结合网站实际情况核验</span></div>`;
  }
  function message(question) {return `<div class="user-message">${esc(question)}</div><article class="assistant-message"><div class="avatar">${icon('spark')}</div><div class="message-body"><div class="message-heading">猎看 AI<span class="badge gray">示例回答</span></div><div class="evidence-meta"><span>${esc(sites[site])}</span><span>${ranges[period]}</span><span>Asia/Shanghai</span></div>${answer(question)}</div></article>`;}
  function conversation() {return `<section class="conversation" aria-label="分析对话">${messages.join('')}<div class="followups"><button class="chip" data-prompt="哪些页面值得优先优化？">哪些页面值得优先优化？ ${icon('right')}</button><button class="chip" data-prompt="AI 引荐带来的转化表现怎么样？">AI 引荐的转化表现怎么样？ ${icon('right')}</button></div>${composer(true)}<p class="footnote">示例回答 · 数据范围随当前网站与时间变化 · AI 建议需核验</p></section>`;}
  function dataPreview() {
    const view=params.get('view'), data=datasets[view], titles={dashboard:'数据总览',websites:'网站管理',boards:'数据看板',tracking:'追踪管理',sharing:'分享管理',teams:'团队管理'};
    return `<div class="workspace">${scope()}<section class="conversation"><a class="button text" href="${url('chat')}">${icon('back')}返回快速发起</a><div class="page-heading" style="margin-top:20px"><div><h1>${data?.title||titles[view]||'数据入口'}</h1><p>后台入口预览 · 已携带网站与时间范围 · 示例数据</p></div><span class="badge gray">${esc(sites[site])}</span></div>${condition()==='empty'?`<div class="empty-state"><h2>当前网站尚无数据</h2><p>先在网站管理中完成数据接入，再回来查看统计。</p>${button('查看接入步骤','setup',true)}</div>`:data?`${period==='30'?'<div class="notice">所选 30 天范围缺少完整数据，下表仅展示最近 7 天的示例。</div>':''}<section class="panel" style="margin-top:16px">${table(data)}</section>`:`<section class="panel"><div class="panel-body"><h2>${view==='websites'?'网站数据接入':'管理入口与 AI 协作'}</h2><p class="answer-text">${view==='websites'?'添加网站 → 安装统计脚本 → 接入抓取日志 → 验证首条数据。':'AI 回答可引导你查看相关后台功能，并保留当前网站与时间范围。'}</p><div class="data-links">${viewLink('查看 AI 抓取','crawls','bars')}${viewLink('查看日志','logs','file')}</div></div></section>`}<div class="notice">本页用于演示回答到后台数据的跳转。完整统计页面沿用现有猎看后台。</div></section></div>`;
  }
  function chatPage() {shell(params.has('view')?dataPreview():`<div class="workspace">${scope()}${messages.length?conversation():landing()}</div>`);}
  async function ask(question) {
    if(!question.trim()){toast('请先输入一个问题');document.querySelector('#question')?.focus();return;}
    if(!configured){toast('先配置 API，即可开始分析；也可以查看对话示例。');document.querySelector('.connect-hint')?.scrollIntoView({block:'nearest'});return;}
    lastQuestion=question.trim().slice(0,2000);const run=++turnRun, old=messages.slice();messages.push(`<div class="user-message">${esc(lastQuestion)}</div><div class="loading-line" role="status">${icon('spark')}正在检索当前范围的示例数据…</div>`);chatPage();document.querySelector('.loading-line')?.scrollIntoView({block:'nearest'});await new Promise(resolve=>setTimeout(resolve,550));if(run!==turnRun)return;messages=[...old,message(lastQuestion)];chatPage();document.querySelector('.assistant-message:last-of-type')?.scrollIntoView({block:'start'});
  }
  root.addEventListener('submit', event=>{
    event.preventDefault();if(event.target.id==='ask-form')ask(document.querySelector('#question').value);
  });
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){document.querySelector('.sidebar').classList.remove('open');document.querySelector('.mobile-menu')?.setAttribute('aria-expanded','false');document.querySelector('.mobile-menu')?.focus();}if(event.target.id==='question'&&event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();ask(event.target.value);}});
  root.addEventListener('change',event=>{
    if(event.target.id==='scene'){scene=event.target.value;configured=scene!=='unconfigured';turnRun++;messages=[];if(scene==='conversation'){site='demo';period='7';lastQuestion='本周 AI 抓取为什么下降？哪些页面值得优先优化？';messages=[message(lastQuestion)];}updateUrl();render();}
    if(['site','period'].includes(event.target.id)){site=document.querySelector('#site').value;period=document.querySelector('#period').value;turnRun++;messages=[];updateUrl();render();}
  });
  root.addEventListener('click',async event=>{
    const target=event.target.closest('[data-action],[data-prompt]');if(!target)return;
    if(target.dataset.prompt){const input=document.querySelector('#question');input.value=target.dataset.prompt;input.focus();return;}
    switch(target.dataset.action){
      case 'menu':document.querySelector('.sidebar').classList.add('open');target.setAttribute('aria-expanded','true');document.querySelector('.sidebar a').focus();break;
      case 'close-nav':document.querySelector('.sidebar').classList.remove('open');document.querySelector('.mobile-menu').setAttribute('aria-expanded','false');document.querySelector('.mobile-menu').focus();break;
      case 'new':turnRun++;messages=[];params.delete('view');if(scene==='conversation')scene='ready';updateUrl();chatPage();document.querySelector('#question').focus();break;
      case 'example':location.href=url('chat',{scene:'conversation',site:'demo',period:'7'});break;
      case 'context':toast(`${sites[site]} · ${ranges[period]} · 仅使用当前范围的授权数据（示例）`);break;
      case 'evidence':{const evidence=target.closest('.message-body').querySelector('.evidence');evidence.open=true;evidence.scrollIntoView({block:'nearest'});break;}
      case 'copy':try{await navigator.clipboard.writeText(target.closest('.message-body').innerText);toast('已复制分析，包含示例数据标记');}catch{toast('当前浏览器无法自动复制，请选择回答文字复制。');}break;
      case 'summary':ask('生成当前网站的分析摘要与下周建议');break;
      case 'retry':scene='ready';messages=[];updateUrl();ask(lastQuestion);break;
      case 'use-seven':scene='ready';period='7';site='demo';messages=[];updateUrl();ask(lastQuestion||'分析最近 7 天的 AI 抓取表现');break;
      case 'setup':toast('接入步骤：添加网站 → 安装统计脚本 → 接入日志 → 验证数据。');break;
    }
  });
  const configController=page==='config'?window.LiekanAIConfig({root,esc,icon,button,shell,toast,getScene:()=>scene,onAvailabilityChange:count=>{configured=count>0;if(scene!=='viewer')scene=count?'ready':'unconfigured';sessionStorage.setItem('liekan-ai-prototype-configured',String(configured));updateUrl();}}):null;
  function render(){page==='config'?configController.render():chatPage();}
  if(!params.has('scene')&&sessionStorage.getItem('liekan-ai-prototype-configured')==='true'){scene='ready';configured=true;}
  if(scene==='conversation'){site='demo';period='7';lastQuestion='本周 AI 抓取为什么下降？哪些页面值得优先优化？';messages=[message(lastQuestion)];}
  render();
})();
