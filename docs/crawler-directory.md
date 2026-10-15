# 蜘蛛目录与当前能力

本目录对应当前审核后的识别注册表。HTTP 名称表示请求声明的身份，官方范围核验单独提供证据。网站关闭规则、旧版自定义配置和站点覆盖会影响实际启用情况，帮助中心可以选择网站查看。

默认识别 53 个 HTTP 名称，其中 20 项计入 AI 请求。16 个固定官方范围来源关联 26 个 HTTP 名称。共享范围只用于明确登记的名称；范围一致不证明内容的最终用途。

| 名称 | 厂商 | 主分类 | AI 请求 | 自动范围来源 | 远端与 Nginx 控制 |
| --- | --- | --- | --- | --- | --- |
| GPTBot | OpenAI | AI 训练 | 是 | [官方范围](https://openai.com/gptbot.json) | 已支持 |
| OAI-SearchBot | OpenAI | AI 搜索 | 是 | [官方范围](https://openai.com/searchbot.json) | 已支持 |
| ChatGPT-User | OpenAI | 用户触发 | 是 | [官方范围](https://openai.com/chatgpt-user.json) | 已支持 |
| OAI-AdsBot | OpenAI | 其他已知 | 否 | [官方范围](https://openai.com/adsbot.json) | 未开放 |
| ClaudeBot | Anthropic | AI 训练 | 是 | [官方范围](https://claude.com/crawling/bots.json) | 已支持 |
| Claude-SearchBot | Anthropic | AI 搜索 | 是 | [官方范围](https://claude.com/crawling/bots.json) | 已支持 |
| Claude-User | Anthropic | 用户触发 | 是 | [官方范围](https://claude.com/crawling/bots.json) | 已支持 |
| PerplexityBot | Perplexity | AI 搜索 | 是 | [官方范围](https://www.perplexity.ai/perplexitybot.json) | 已支持 |
| Perplexity-User | Perplexity | 用户触发 | 是 | [官方范围](https://www.perplexity.ai/perplexity-user.json) | 已支持 |
| Amazonbot | Amazon | AI 训练 | 是 | 未接入 | 未开放 |
| Amzn-SearchBot | Amazon | AI 搜索 | 是 | 未接入 | 未开放 |
| Amzn-User | Amazon | 用户触发 | 是 | 未接入 | 未开放 |
| MistralAI-User | Mistral AI | 用户触发 | 是 | [官方范围](https://mistral.ai/mistralai-user-ips.json) | 未开放 |
| MistralAI-Index | Mistral AI | AI 搜索 | 是 | [官方范围](https://mistral.ai/mistralai-index-ips.json) | 未开放 |
| MistralAI-Training | Mistral AI | AI 训练 | 是 | 未接入 | 未开放 |
| Googlebot | Google | 传统搜索 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 已支持 |
| Googlebot-Image | Google | 传统搜索 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Googlebot-Video | Google | 传统搜索 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| GoogleOther | Google | 其他已知 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| GoogleOther-Image | Google | 其他已知 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| GoogleOther-Video | Google | 其他已知 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Storebot-Google | Google | 传统搜索 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Google-InspectionTool | Google | 用户触发 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Google-CloudVertexBot | Google | 其他已知 | 否 | [官方范围](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) | 未开放 |
| Applebot | Apple | 传统搜索 | 否 | [官方范围](https://search.developer.apple.com/applebot.json) | 已支持 |
| bingbot | Microsoft | 传统搜索 | 否 | [官方范围](https://www.bing.com/toolbox/bingbot.json) | 已支持 |
| DuckDuckBot | DuckDuckGo | 传统搜索 | 否 | [官方范围](https://duckduckgo.com/duckduckbot.json) | 未开放 |
| DuckAssistBot | DuckDuckGo | AI 搜索 | 是 | [官方范围](https://duckduckgo.com/duckassistbot.json) | 未开放 |
| CCBot | Common Crawl | 其他已知 | 否 | [官方范围](https://index.commoncrawl.org/ccbot.json) | 未开放 |
| AI2Bot | Ai2 | AI 训练 | 是 | 未接入 | 未开放 |
| Baiduspider | 百度 | 传统搜索 | 否 | 未接入 | 已支持 |
| Baiduspider-render | 百度 | 传统搜索 | 否 | 未接入 | 未开放 |
| Sogou web spider | 搜狗 | 传统搜索 | 否 | 未接入 | 未开放 |
| Sogou inst spider | 搜狗 | 传统搜索 | 否 | 未接入 | 未开放 |
| 360Spider | 360 | 传统搜索 | 否 | 未接入 | 未开放 |
| YandexBot | Yandex | 传统搜索 | 否 | 未接入 | 未开放 |
| Yeti | Naver | 传统搜索 | 否 | 未接入 | 未开放 |
| Ads-Naver | Naver | 其他已知 | 否 | 未接入 | 未开放 |
| Blueno | Naver | 其他已知 | 否 | 未接入 | 未开放 |
| SeznamBot | Seznam | 传统搜索 | 否 | 未接入 | 未开放 |
| FreshBot | Seznam | 传统搜索 | 否 | 未接入 | 未开放 |
| Qwantbot | Qwant | 传统搜索 | 否 | 未接入 | 未开放 |
| Qwantbot-news | Qwant | 传统搜索 | 否 | 未接入 | 未开放 |
| MojeekBot | Mojeek | 传统搜索 | 否 | 未接入 | 未开放 |
| Meta-ExternalAgent | Meta | AI 训练 | 是 | 未接入 | 未开放 |
| Meta-ExternalFetcher | Meta | 用户触发 | 是 | 未接入 | 未开放 |
| FacebookBot | Meta | AI 训练 | 是 | 未接入 | 未开放 |
| Bytespider | 字节跳动 | AI 训练 | 是 | 未接入 | 已支持 |
| AhrefsBot | Ahrefs | 其他已知 | 否 | [官方范围](https://api.ahrefs.com/v3/public/crawler-ip-ranges) | 未开放 |
| AhrefsSiteAudit | Ahrefs | 其他已知 | 否 | 未接入 | 未开放 |
| SemrushBot | Semrush | 其他已知 | 否 | 未接入 | 未开放 |
| SiteAuditBot | Semrush | 其他已知 | 否 | 未接入 | 未开放 |
| MJ12bot | Majestic | 其他已知 | 否 | 未接入 | 未开放 |

PetalBot 保持待复核。Google-Extended、Googlebot-News、Applebot-Extended 属于 robots 用途控制项，HTTP 请求不会据此获得独立官方身份。Meta 与 Bytespider 保留观察来源标签。Amazon 地址入口目前没有接入可验证的机器接口，自动范围核验保持未支持。

robots 草稿按各条目已确认的 token 提供；HTTP 识别范围与远端控制范围各自审核。新增名称不会扩大现有 Cloudflare 或 Nginx 写入能力。

目录、帮助、匹配正反例和来源绑定由版本检查共同验证。任何来源访问失败均记录运行状态，不能据此补造成功或扩大厂商适用范围。
