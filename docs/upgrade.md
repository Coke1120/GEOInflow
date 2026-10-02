# 更新检查入口

完整流程见 [持续吸收 Umami 更新](upstream-upgrade.md)。日常开发可运行 `pnpm liekan:verify --working-tree`；该模式记录工作区指纹，生成结果或源码在执行期间改变时仍然失败。

发布和上游同步候选使用默认 `pnpm liekan:verify`，要求已提交的干净工作区，并冻结 HEAD、源码、依赖锁和生成客户端。工作区变化或未提交的生成文件阻止通过。默认验证继续构建该候选的 Docker 镜像，在临时实例完成完整 API、空库初始化、备份恢复、迁移、2FA 兼容和原型视觉检查。源码检查与完整结果分别保存在被忽略的 `outputs/verification.json` 与 `outputs/acceptance.json`。单独的 `--source-only` 模式适合 CI，不能作为完整定版依据。

自有维护工具只准备候选和验证，部署切换由已验收版本完成。未知数据、原 Umami 工作区与现有卷保持独立。
