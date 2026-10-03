# Liekan · 猎看统计

面向 GEO 增长的 AI 与搜索流量分析系统。Liekan 基于 Umami v3.4.0，保留浏览器采集、账号权限、网站与团队、目标和漏斗，通过独立日志接入分析 AI 抓取行为与搜索引荐。

主项目采用 MIT 许可，保留 Umami 版权。第三方组件和地理数据许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

当前版本为 0.2.0，本地体验默认地址为 **http://localhost:3002**。新增数据库和容器与原 Umami 独立。

- 保留 11 个 GEO 统计页面与 22 个图表，接入已确认的 68 个补充 UI 场景。
- 人类 PV/UV、来源、地域、内容、目标与漏斗复用 Umami 数据。
- AI 抓取来自上传的服务器 combined / JSON 日志，支持蜘蛛分类、官方 IP 范围匹配、覆盖和路径观察。
- sitemap / CSV / JSON 内容目录、网站级规则、robots 草稿和 CIDR 白名单管理。
- 网站接入、身份安全、目标漏斗、访客分析、工作台、看板、协作、分享和扩展统计使用统一 UI。
- 完整导出支持 ZIP、CSV 和 JSON，提供真实进度、取消、字段清单和敏感信息处理；演示站独立标识。

补充旅程、明细和完整导出当前支持 PostgreSQL；ClickHouse 保留兼容入口。新 UI 当前采用简体中文与浅色规范，旧配置保持可读。功能范围及限制见 [页面覆盖](docs/ui-coverage.md)。

缺少输入、空数据、估算和未支持的字段分别展示。持续源站采集、正文完成率、自动内容评分、执行拦截和搜索曝光/排名属于后续能力。

## 安装与开发

使用 Node.js **22.23.3** 与 pnpm **12.3.4**。复制 `env.example` 到私有 `.env`，填写独立数据库及密钥。迁移已有数据时沿用原应用和 2FA 密钥。

```sh
pnpm install --frozen-lockfile
pnpm build:db
pnpm db:migrate
pnpm liekan:migrate
pnpm build:openapi
pnpm build:packages
pnpm dev
```

Docker 部署、备份与恢复步骤见 [本地部署说明](docs/local-deployment.md)。首次使用可运行 `pnpm liekan:seed-demo`，创建单独的演示站。

首次安装的默认用户名为 `admin`，密码为 `liekan`。Liekan 迁移会更新仍使用上游初始密码的默认管理员，保留已自行设置的密码。

## 维护与升级

```sh
pnpm liekan:upstream:report --tag vX.Y.Z
pnpm liekan:upstream:prepare --tag vX.Y.Z
pnpm liekan:verify
```

更新工具从官方 upstream 获取稳定版本，在隔离候选中保留历史并合并。Liekan 自有 UI、数据契约、适配层与独立 SQL 迁移共同保护产品行为。验证通过后再更新本地 main 和发布标签。

完整说明见 [上游更新流程](docs/upstream-upgrade.md)、[统计口径](docs/data-definitions.md)、[页面覆盖与下一阶段缺口](docs/ui-coverage.md)、[设计约束](DESIGN.md)。本机构建阶段尚未配置远端仓库和镜像发布渠道。
