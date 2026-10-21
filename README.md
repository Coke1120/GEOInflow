# GEOInflow

联合发布：猎看科技　北京日报社智源GEO。

沿用 Liekan 的兼容接口和部署标识，基于 Umami 开发并保留 MIT 版权与许可。

面向 GEO 增长的 AI 与搜索流量分析系统。GEOInflow 基于 Umami v3.4.0，保留浏览器采集、账号权限、网站与团队、目标和漏斗，通过独立日志接入分析 AI 抓取行为与搜索引荐。

主项目采用 MIT 许可，完整版权与许可声明见 [LICENSE](LICENSE)。第三方组件和地理数据许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

企业私有仓库：[liekan/liekan-statistics](https://gitee.com/liekan/liekan-statistics)。访问需要对应企业仓库权限。

当前版本为 v1.2（工程版本 1.2.0），本地体验默认地址为 **http://localhost:3002**。新增数据库和容器与原 Umami 独立。

- 保留 11 个 GEO 统计页面与 22 个图表，接入已确认的 68 个补充 UI 场景。
- 人类 PV/UV、来源、地域、内容、目标与漏斗复用 Umami 数据。
- AI 抓取来自上传的服务器 combined / JSON 日志，支持蜘蛛分类、官方 IP 范围匹配、覆盖和路径观察。
- 统一爬虫管理维护平台、产品、请求身份和官方来源，支持版本发布与回滚，国内外 AI 平台及个人 Agent 的核验状态分别展示。
- GEO 权重 Beta 汇总最近 30 个完整自然日的已核验 AI 内容访问，在流量总览和 AI 抓取总览展示分数、等级、计算明细与 CSV 导出。
- sitemap / CSV / JSON 内容目录、网站级规则、robots 草稿和 CIDR 白名单管理。
- 网站接入、身份安全、目标漏斗、访客分析、工作台、看板、协作、分享和扩展统计使用统一 UI。
- 完整导出支持 ZIP、CSV 和 JSON，提供真实进度、取消、字段清单和敏感信息处理；演示站独立标识。

补充旅程、明细和完整导出当前支持 PostgreSQL；ClickHouse 保留兼容入口。新 UI 当前采用简体中文与浅色规范，旧配置保持可读。功能范围及限制见 [页面覆盖](docs/ui-coverage.md)。

缺少输入、空数据、估算和未支持的字段分别展示。持续源站采集、正文完成率、自动内容评分、执行拦截和搜索曝光/排名属于后续能力。

## 安装与开发

服务器已安装并启动 Docker 与 Docker Compose 后，在项目根目录执行：

```sh
sh scripts/liekan-deploy.sh
```

首次执行自动生成私有配置与随机密钥、准备地理数据、构建镜像、应用迁移并等待服务健康。重复执行保留已有配置、管理员密码与数据库。默认访问地址为 `http://127.0.0.1:3002`；公网使用反向代理配置域名与 HTTPS。首次安装账号为 `admin / liekan`。源码构建需要服务器能够访问依赖与镜像下载源。

地域数据默认使用无需账号的 DB-IP City Lite，已有授权的 MaxMind City 文件会优先保留。首次下载失败时停止构建，网络恢复后重跑同一命令即可。运行时缺库或损坏仍会采集访问，无法确定的地域字段保持缺失。数据来源、许可和可选 MaxMind 配置见 [部署说明](docs/local-deployment.md)。

使用 Node.js **22.23.3** 与 pnpm **12.3.4**。复制 `env.example` 到私有 `.env`，填写独立数据库及密钥。迁移已有数据时沿用原应用和 2FA 密钥。

```sh
pnpm install --frozen-lockfile
pnpm build:db
pnpm db:migrate
pnpm liekan:migrate
pnpm liekan:seed-demo
pnpm build:openapi
pnpm build:packages
pnpm dev
```

Docker 部署、备份与恢复步骤见 [本地部署说明](docs/local-deployment.md)。默认示例为 **“猎看官网（示例数据）”**，域名为 `www.liekan.com`。`pnpm liekan:seed-demo` 从随代码分发的数据包初始化该网站，包含浏览访问、AI 抓取日志、内容目录、转化目标和漏斗。首次导入会将访问时间平移到当前日期范围，重复运行保留已有数据。数据范围及安全约束见 [默认示例说明](docs/default-demo.md)。

首次安装的默认用户名为 `admin`，密码为 `liekan`。Liekan 迁移会更新仍使用上游初始密码的默认管理员，保留已自行设置的密码。

普通登录和双重验证完成后的登录状态默认保留 90 天。同一浏览器、同一访问地址再次打开后台会自动验证并恢复登录；主动退出、密码变更或账号删除后需要重新登录。

## 维护与升级

```sh
pnpm liekan:upstream:report --tag vX.Y.Z
pnpm liekan:upstream:prepare --tag vX.Y.Z
pnpm liekan:verify
```

更新工具从官方 upstream 获取稳定版本，在隔离候选中保留历史并合并。Liekan 自有 UI、数据契约、适配层与独立 SQL 迁移共同保护产品行为。验证通过后再更新本地 main 和发布标签。

系统组成与源码入口见 [系统说明](docs/system-overview.md)。维护规则见 [上游更新流程](docs/upstream-upgrade.md)、[统计口径](docs/data-definitions.md)、[页面覆盖与下一阶段缺口](docs/ui-coverage.md)、[设计约束](DESIGN.md)。镜像发布渠道需按部署环境配置。

爬虫身份与管理规则见 [蜘蛛目录](docs/crawler-directory.md)、[识别与统一管理](docs/crawler-recognition.md)；GEO 权重的公式、证据要求及适用范围见 [GEO 权重说明](docs/geo-weight.md)。
