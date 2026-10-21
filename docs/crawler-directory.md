# 蜘蛛目录与当前能力

本目录对应当前审核后的识别注册表。HTTP 名称表示请求声明的身份，官方范围核验单独提供证据。网站关闭规则、旧版自定义配置和站点覆盖会影响实际启用情况，帮助中心可以选择网站查看。

内置初始目录收录 80 个平台、134 个产品和 65 个身份条目，其中 85 个产品登记为 AI 工作台；启用 60 个 HTTP 身份和 1 个签名身份，27 个启用身份具有 AI 请求资格。工作台产品资料与网络身份分别审核，待核实产品保留空身份绑定。24 个官方范围来源关联 34 个 HTTP 名称，包含一个人工审核来源。实际运行数量以 `/crawlers/manage` 当前发布版本为准。共享范围只用于明确登记的名称；范围一致不证明内容的最终用途。

| 名称 | 厂商 | 用途分类 | AI 请求 | 自动范围来源 | 远端与 Nginx 控制 |
| --- | --- | --- | --- | --- | --- |
| GPTBot | OpenAI | AI 训练 | 是 | [官方范围](https://openai.com/gptbot.json) | 已支持 |
| OAI-SearchBot | OpenAI | AI 搜索 | 是 | [官方范围](https://openai.com/searchbot.json) | 已支持 |
| ChatGPT-User | OpenAI | 用户触发 | 是 | [官方范围](https://openai.com/chatgpt-user.json) | 已支持 |
| OAI-AdsBot | OpenAI | 其他用途 | 否 | [官方范围](https://openai.com/adsbot.json) | 未开放 |
| ClaudeBot | Anthropic | AI 训练 | 是 | [官方范围](https://claude.com/crawling/bots.json) | 已支持 |
| Claude-SearchBot | Anthropic | AI 搜索 | 是 | [官方范围](https://claude.com/crawling/bots.json) | 已支持 |
| Claude-User | Anthropic | 用户触发 | 是 | [官方范围](https://claude.com/crawling/bots.json) | 已支持 |
| PerplexityBot | Perplexity | AI 搜索 | 是 | [官方范围](https://www.perplexity.ai/perplexitybot.json) | 已支持 |
| Perplexity-User | Perplexity | 用户触发 | 是 | [官方范围](https://www.perplexity.ai/perplexity-user.json) | 已支持 |
| Amazonbot | Amazon | AI 训练 | 是 | [官方范围](https://developer.amazon.com/amazonbot/ip-addresses/) | 未开放 |
| Amzn-SearchBot | Amazon | AI 搜索 | 是 | [官方范围](https://developer.amazon.com/amazonbot/searchbot-ip-addresses/) | 未开放 |
| Amzn-User | Amazon | 用户触发 | 是 | [官方范围](https://developer.amazon.com/amazonbot/live-ip-addresses/) | 未开放 |
| MistralAI-User | Mistral AI | 用户触发 | 是 | [官方范围](https://mistral.ai/mistralai-user-ips.json) | 未开放 |
| MistralAI-Index | Mistral AI | AI 搜索 | 是 | [官方范围](https://mistral.ai/mistralai-index-ips.json) | 未开放 |
| MistralAI-Training | Mistral AI | AI 训练 | 是 | 未接入 | 未开放 |
| Googlebot | Google | 传统搜索 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 已支持 |
| Googlebot-Image | Google | 传统搜索 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Googlebot-Video | Google | 传统搜索 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| GoogleOther | Google | 其他用途 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| GoogleOther-Image | Google | 其他用途 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| GoogleOther-Video | Google | 其他用途 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Storebot-Google | Google | 传统搜索 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Google-InspectionTool | Google | 用户触发 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Google-CloudVertexBot | Google | 其他用途 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Applebot | Apple | 传统搜索 | 否 | [官方范围](https://search.developer.apple.com/applebot.json) | 已支持 |
| bingbot | Microsoft | 传统搜索 | 否 | [官方范围](https://www.bing.com/toolbox/bingbot.json) | 已支持 |
| DuckDuckBot | DuckDuckGo | 传统搜索 | 否 | [官方范围](https://duckduckgo.com/duckduckbot.json) | 未开放 |
| DuckAssistBot | DuckDuckGo | AI 搜索 | 是 | [官方范围](https://duckduckgo.com/duckassistbot.json) | 未开放 |
| CCBot | Common Crawl | 其他用途 | 否 | [官方范围](https://index.commoncrawl.org/ccbot.json) | 未开放 |
| AI2Bot | Ai2 | AI 训练 | 是 | 未接入 | 未开放 |
| Baiduspider | 百度 | 传统搜索 | 否 | 未接入 | 已支持 |
| Baiduspider-render | 百度 | 传统搜索 | 否 | 未接入 | 未开放 |
| Sogou web spider | 搜狗 | 传统搜索 | 否 | 未接入 | 未开放 |
| Sogou inst spider | 搜狗 | 传统搜索 | 否 | 未接入 | 未开放 |
| 360Spider | 360 | 传统搜索 | 否 | 未接入 | 未开放 |
| YandexBot | Yandex | 传统搜索 | 否 | 未接入 | 未开放 |
| Yeti | Naver | 传统搜索 | 否 | 未接入 | 未开放 |
| Ads-Naver | Naver | 其他用途 | 否 | 未接入 | 未开放 |
| Blueno | Naver | 其他用途 | 否 | 未接入 | 未开放 |
| SeznamBot | Seznam | 传统搜索 | 否 | 未接入 | 未开放 |
| FreshBot | Seznam | 传统搜索 | 否 | 未接入 | 未开放 |
| Qwantbot | Qwant | 传统搜索 | 否 | 未接入 | 未开放 |
| Qwantbot-news | Qwant | 传统搜索 | 否 | 未接入 | 未开放 |
| MojeekBot | Mojeek | 传统搜索 | 否 | 未接入 | 未开放 |
| Meta-ExternalAgent | Meta | AI 训练 | 是 | 未接入 | 未开放 |
| Meta-ExternalFetcher | Meta | 用户触发 | 是 | 未接入 | 未开放 |
| FacebookBot | Meta | AI 训练 | 是 | 未接入 | 未开放 |
| Bytespider | 字节跳动 | AI 训练 | 是 | 未接入 | 已支持 |
| AhrefsBot | Ahrefs | 其他用途 | 否 | [官方范围](https://api.ahrefs.com/v3/public/crawler-ip-ranges) | 未开放 |
| AhrefsSiteAudit | Ahrefs | 其他用途 | 否 | 未接入 | 未开放 |
| SemrushBot | Semrush | 其他用途 | 否 | 未接入 | 未开放 |
| SiteAuditBot | Semrush | 其他用途 | 否 | 未接入 | 未开放 |
| MJ12bot | Majestic | 其他用途 | 否 | 未接入 | 未开放 |
| KimiBot | 月之暗面 | AI 训练 | 是 | [官方范围](https://www.kimi.ai/policies/kimibot.json) | 未开放 |
| Kimi-SearchBot | 月之暗面 | AI 搜索 | 是 | [官方范围](https://www.kimi.ai/policies/kimi-searchbot.json) | 未开放 |
| Kimi-User | 月之暗面 | 用户触发 | 是 | [官方范围](https://www.kimi.ai/policies/kimi-user.json) | 未开放 |
| HySpider | 腾讯 | AI 训练 | 是 | [官方范围](https://hy.tencent.com/policy/hyspider.json) | 未开放 |
| ExaSearchBot | Exa | AI 搜索 | 是 | 未接入，登记官方签名资料 | 未开放 |
| ExaUser | Exa | 用户触发 | 是 | 未接入，登记官方签名资料 | 未开放 |
| Kagibot | Kagi | 传统搜索 | 否 | [人工审核范围](https://kagi.com/bot) | 未开放 |
| ChatGPT Agent | OpenAI | 未知用途／个人 Agent | 是 | 签名元数据、可信 Cloudflare 精确证据 | 未开放 |

PetalBot 保持待复核。Google-Extended、Googlebot-News、Applebot-Extended 属于 robots 用途控制项，HTTP 请求不会据此获得独立官方身份。Meta 与 Bytespider 保留观察来源标签。Amazon 三个官方地址入口已分别接入，范围只绑定其声明的训练、搜索和用户触发身份。

robots 草稿按各条目已确认的 token 提供；HTTP 识别范围与远端控制范围各自审核。新增名称不会扩大现有 Cloudflare 或 Nginx 写入能力。

目录、帮助、匹配正反例和来源绑定由版本检查共同验证。任何来源访问失败均记录运行状态，不能据此补造成功或扩大厂商适用范围。

DeepSeek、豆包工作、豆包工作伙伴、千问、元宝、微信搜一搜、WorkBuddy、ima、Cue 等产品已单独建档。缺少官方网络身份规范的产品标记待核实；已有厂商爬虫不会自动分配给旗下全部产品。AI 引荐主机与产品身份分开维护，当前初始版本包含 38 条引荐规则。微信普通浏览器标记不用于排除真人访问。

表格按用途分类，个人 Agent 产品形态另行注明。页面“其他爬虫”筛选排除 AI 训练、AI 搜索、用户触发、传统搜索、AI 工作台和个人 Agent 六个分类；用途为“其他用途”的记录仍可同时属于工作台或个人 Agent。

用途、产品形态、请求真实性及来源健康的边界见 [识别与统一管理](crawler-recognition.md)。
