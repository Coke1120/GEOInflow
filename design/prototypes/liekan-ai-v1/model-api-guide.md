# 主流模型 API 接入指南

核对日期：2026-10-04。本指南与原型模板供配置评审使用。模型、权限、可用地域以对应官方控制台为准；正式接入由服务端执行请求，原型展示模拟测试过程。

## 新建流程

1. 打开 AI配置器，点击列表右上角“新建 API”。
2. 勾选一个模型，系统填写连接名称、模型标识、API 基础地址与协议。
3. 填写对应服务的 Key，保存回到列表。
4. 点击“实时测试”，查看检查进度、请求摘要、首字耗时、响应状态与测试回答。
5. 测试通过后，可以设为快速发起的默认分析模型。

通用模板只需填写 Key。编辑时更换供应商，需要填写新供应商的 Key；更新配置后应重新测试，再设为默认模型。自定义网关或跨地域连接需要在高级配置中修改地址等信息。原型请使用“填入演示 Key”；它不保存或发送真实密钥。

## 官方模板

| 服务 | 模型标识 | API 基础地址 | 协议 | 官方来源 |
| --- | --- | --- | --- | --- |
| OpenAI | `gpt-5.4-mini` | `https://api.openai.com/v1` | OpenAI Chat Completions | [模型与支持接口](https://developers.openai.com/api/docs/models/gpt-5.4-mini)、[Chat API](https://developers.openai.com/api/reference/resources/chat) |
| Anthropic | `claude-sonnet-5-5` | `https://api.anthropic.com/v1` | Anthropic Messages | [API 与鉴权](https://platform.claude.com/docs/en/api/overview)、[模型列表](https://platform.claude.com/docs/en/models/overview) |
| Google Gemini | `gemini-3.8-flash` | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI Chat Completions | [官方兼容接口](https://ai.google.dev/gemini-api/docs/openai) |
| DeepSeek | `deepseek-flash` | `https://api.deepseek.com` | OpenAI Chat Completions | [首次调用与模型标识](https://api-docs.deepseek.com/) |
| 阿里云百炼 | `qwen-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI Chat Completions | [官方兼容接口与地域规则](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope) |
| Kimi | `kimi-k3` | `https://api.moonshot.cn/v1` | OpenAI Chat Completions | [Kimi 快速开始](https://platform.kimi.com/docs/get-api-key) |
| MiniMax | `MiniMax-M3` | `https://api.minimax.io/v1` | OpenAI Chat Completions | [OpenAI SDK 与支持模型](https://platform.minimax.io/docs/api-reference/text-openai-api) |

OpenAI 兼容连接的调用路径为基础地址加 `/chat/completions`，鉴权使用 `Authorization: Bearer <API_KEY>`。Anthropic 模板调用 `/messages`，采用仍受支持的 `x-api-key` 与 `anthropic-version: 2023-06-01`。请求与日志展示应隐藏认证值。

## 地域与账号条件

- 千问模板默认北京地域，Key 必须来自同一地域。官方推出业务空间专属域名，旧域名仍可使用；专属域名需要填写 WorkspaceId。新加坡等地域须根据对应控制台调整地址与 Key。
- Kimi 模板采用中国站基础地址。
- MiniMax 模板采用国际站按量付费 API。中国站与其他套餐需核对对应控制台配置。选用已列入官方兼容接口支持范围的 `MiniMax-M3`。
- Claude 的多空间 API Key 需要 `anthropic-workspace-id`。本原型模板覆盖普通单空间 Key；多空间模式需在正式实现中增加该字段。
- 本原型覆盖七家服务的直接 API 模板。Azure、Bedrock、Vertex 等云平台需要额外部署或身份参数，可在后续接入时设计对应表单。

## 实时测试的展示口径

宽屏弹窗左侧展示连接检查、凭证检查、模型调用和流式返回；右侧展示脱敏请求摘要、简短提问、逐步输出与事件记录。首字与总耗时由原型实际播放时间计算，状态持续注明“模拟”。测试不需要网站日志。

正常、Key 无效和超时场景可以切换；取消、关闭或重新测试会取消旧任务的后续展示。完成的结果更新到对应列表行，保留最近测试时间。

## 正式接入的排查提示

| 响应 | 优先检查 |
| --- | --- |
| 401 | Key 是否有效，是否属于对应平台及地域 |
| 403 | 模型访问权限与账号策略 |
| 404 | 基础地址、调用路径与模型标识 |
| 429 | 账号额度、频率或并发限制 |
| 超时 | 网络、供应商服务状态与调用时限 |

这些提示用于引导核查，实际原因应依据供应商的错误码与响应内容判断。正式测试应由授权的服务端接口执行，界面只接收脱敏结果。
