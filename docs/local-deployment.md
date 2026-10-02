# 本地安装、体验与恢复

要求 Docker Desktop、Node.js 22.23.3、pnpm 12.3.4。应用 http://127.0.0.1:3002，专用 PostgreSQL 在本机 15435，新卷 liekan_liekan-data。原 Umami 的 3001 入口和 umami_umami-db-data 卷保持独立。

首次安装复制 env.example 到 .env，替换随机密码与密钥，文件权限设为 0600。迁移已有 Umami 数据时沿用原 APP_SECRET 与 TWO_FACTOR_ENCRYPTION_KEY，避免既有会话、身份标识和 2FA 加密数据失配。DATABASE_URL 指向新的副本，所有备份与配置都不纳入 Git。

开发时安装冻结依赖、生成 Prisma 客户端、生成 OpenAPI/SDK 并构建工作区包。先执行上游 `pnpm db:migrate`，再运行 `pnpm liekan:migrate`。`pnpm liekan:seed-demo` 创建单独的“Liekan 演示站（示例数据）”，保持已有管理员密码。

构建前准备 geo/GeoLite2-City.mmdb。现有部署可复制已获授权的地理库，公开部署请使用符合 MaxMind 数据条款的来源。首次安装先运行独立数据库并完成迁移和演示站接入，再将已审查代码提交。完整验收会生成带候选 SHA 的镜像，验收通过后给该镜像固定版本标签并启动体验服务：

```sh
pnpm liekan:verify
docker tag "liekan:candidate-$(git rev-parse --short=12 HEAD)" liekan:0.1.0
docker compose -f docker-compose.liekan.yml up -d --no-build
```

启动依次检查并应用 Umami 迁移、应用 Liekan 校验和迁移、更新 tracker 文件、启动服务器。应用健康检查通过后使用沿用的账号登录。数据库为空时，上游初始化会创建默认管理员，请按现有安装流程设置密码。

每次升级先导出数据备份，并记录镜像 SHA、代码标签和迁移版本。启动新版本后检查登录/2FA、网站切换、人类指标、日志导入、目录管理、目标、CSV 与数据总量。应用回退采用已记录镜像；若迁移改变数据或不向后兼容，需要从备份恢复至新的卷再验证。删除数据库卷、清空数据和重置历史均需要明确授权。

Compose 使用专用 10.253.30.0/24 网段。其他机器部署时核对该网段与既有网络，冲突时在 Compose 中改为已核验的空闲网段。构建结果默认只保存在本机，未发布到镜像仓库。

完整验收使用临时 3302 端口，源数据库只导出备份，API 回归在本次创建的空库执行。恢复副本核对业务总量、角色、目标、已有 2FA 密文和迁移校验和，再完成原型视觉验收。成功后清理临时容器、数据库卷和网络，备份及脱敏报告保留在被 Git 忽略的私有 `outputs/acceptance-*` 目录。验收失败时体验服务继续运行当前镜像。固定版本标签已有镜像时先核对 image ID，保留旧版本用于恢复。
