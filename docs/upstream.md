# 上游兼容范围

当前基础为 Umami v3.4.0，接受版本与完整提交记录在 config/liekan/upstream.json。认证、网站/团队、采集协议、原始数据库、OpenAPI 操作和 SDK 包名保留兼容。Liekan 产品名与版本独立维护。

Liekan 页面使用自有契约，基础数据、权限与内部模块由 src/lib/liekan/upstream 集中适配。必须修改的核心接入点逐文件登记在 core-overrides.json；新增功能优先放自有目录。升级遵循 [更新流程](upstream-upgrade.md)。

自有 SQL 迁移使用独立 liekan_migration 账本，已执行文件保持 SHA-256 不变。网站 UUID 外键由扩展侧维护，删除级联用于隔离网站数据生命周期，防止已删除 UUID 被重建时暴露历史记录；上游 website 表保持原列与索引，增量新增 `site_number` 列与唯一索引作为展示与导航用的短站点编号（101 起的序列），不参与采集与统计。网站统计重置接入独立清理适配器，保留目录和策略配置。

每次更新核对上游所依赖的表、列与类型；兼容检查失败时停止启动。官方数据库迁移、Liekan 迁移、契约、权限和冻结 UI 分别通过后，才能接受候选。
