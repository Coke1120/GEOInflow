# 持续吸收 Umami 更新

Liekan 保留 Umami Git 历史。upstream 指向官方仓库；main 保存已验收的 Liekan 版本；feature/* 用于产品迭代；upstream-sync/* 用于上游升级候选。Liekan 自有前端通过稳定契约连接 src/lib/liekan/upstream，认证、权限和原统计算法集中适配。必要核心修改逐文件记录在 config/liekan/core-overrides.json。

1. 在现有运行版本导出数据库备份，保留镜像 ID、标签、APP_SECRET 和 TWO_FACTOR_ENCRYPTION_KEY。环境配置和备份放私有位置。
2. 使用 Node.js 22.23.3、pnpm 12.3.4，运行 `pnpm liekan:upstream:report --tag vX.Y.Z`。工具核对官方 remote、获取目标发布并输出变更、核心重叠和关键路径报告，不修改 main。
3. 运行 `pnpm liekan:upstream:prepare --tag vX.Y.Z`。工具从已提交 main 创建隔离 worktree，执行保留历史的合并。候选目录和分支记录在报告中，当前工作区保留。冲突留在候选内处理。
4. 在候选检查上游发布说明，处理认证、数据库、框架、包接口与已登记改动的交集；同步兼容适配层和契约，不改原型基准。新增 Liekan 迁移追加文件，既有迁移校验和保持不变。
5. 在干净的已提交候选运行 `pnpm liekan:verify`。工具先检查冻结依赖、SDK/OpenAPI、类型、测试、原型与迁移指纹、导入边界和生产构建，再构建 revision 对应的候选镜像，在临时 Docker 中验证空库初始化、完整 API、数据库副本恢复、迁移二次运行、11 页和 22 图的视觉对照。完整结果写入 `outputs/acceptance.json`，源码检查写入 `outputs/verification.json`。
6. 完整验收需要运行独立 Liekan 数据库、私有 `.env`、地理数据库，以及 `.local/ui-test.env` 中的登录凭据。工具只对现有 Liekan 库导出备份，在临时 3302 端口执行回归，退出时清理自己创建的容器和卷。恢复后的业务总量必须与同一备份升级前一致，迁移账本按候选版本和校验和验证。原有体验服务保持当前镜像。
7. 记录目标 tag/SHA、UI 指纹、依赖锁、迁移校验和与镜像 revision，更新 upstream.json 的最后接受版本。将已审查候选合并到 main，创建新的 Liekan 发布标签。

升级报告和候选创建均可独立运行。失败时停留在候选中检查，默认工具不切换容器、不替换数据库、不推送远端。部署新迁移后，应用镜像回退需要检查 schema 兼容性；涉及不可逆的数据改变时应使用完整备份恢复到独立卷验证后切换。

认证、会话、SDK 命名、tracker 的 /api/send、脚本全局名及上游数据库字段保持兼容。公开版本同时保留 Umami 版权和依赖许可。正式开源前还需要配置 Liekan 仓库 origin、外部 CI、发布地址与审查可分发数据；当前阶段只在本机构建。

源码检查可单独运行 `pnpm liekan:verify --source-only`，开发中的未提交修改使用 `--working-tree`。这两种模式只提供源码检查结果，完整定版依据为 `outputs/acceptance.json` 的 `passed`、`finalized`、候选 HEAD 和镜像 ID。远端 CI 当前只配置源码检查，首次正式发布前应补充同版本的完整验收任务。视觉凭据文件使用 `LIEKAN_TEST_USERNAME` 与 `LIEKAN_TEST_PASSWORD`，对应副本中有网站访问权限且无需交互式 2FA 的专用测试账号。
