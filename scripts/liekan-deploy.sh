#!/bin/sh
set -eu

if [ "${1:-}" = '--help' ]; then
  printf '%s\n' '用法：sh scripts/liekan-deploy.sh' '需要 Docker 和 Docker Compose。首次生成私有配置，构建并启动猎看统计；再次运行保留配置与数据。'
  exit 0
fi
if [ "$#" -ne 0 ]; then
  printf '%s\n' '用法：sh scripts/liekan-deploy.sh' >&2
  exit 1
fi
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' '请先安装并启动 Docker 和 Docker Compose。' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf '%s\n' '无法连接 Docker，请确认服务已启动，当前用户有访问权限。' >&2
  exit 1
fi
umask 077
mkdir -p .local
deployment_lock=.local/liekan-deploy.lock
# The operating system releases this lock after the shell and its children exit.
exec 9> "$deployment_lock"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    printf '%s\n' '另一个部署正在执行，请等待它结束。' >&2
    exit 1
  fi
elif command -v lockf >/dev/null 2>&1; then
  if ! lockf -s -t 0 9; then
    printf '%s\n' '另一个部署正在执行，请等待它结束。' >&2
    exit 1
  fi
else
  printf '%s\n' '需要系统锁工具 flock（Linux util-linux）或 lockf（macOS）来安全执行部署。' >&2
  exit 1
fi
temporary=''
cleanup() {
  if [ -n "$temporary" ]; then rm -f "$temporary"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

if [ ! -e .env ] && [ ! -L .env ]; then
  # Existing volumes need their original configuration, including app and 2FA keys.
  existing_volumes=$(docker volume ls --format '{{.Name}}')
  existing_database=''
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    if printf '%s\n' "$existing_volumes" | grep -Fx "${COMPOSE_PROJECT_NAME}_liekan-data" >/dev/null; then
      existing_database=1
    fi
  elif printf '%s\n' "$existing_volumes" | grep -E '_liekan-data$' >/dev/null; then
    # A lost .env may have contained a custom Compose project name.
    existing_database=1
  fi
  if [ -n "$existing_database" ]; then
    printf '%s\n' '发现已有猎看数据库，请恢复原 .env 后再部署，以保留数据库密码、应用密钥和双重验证密钥。' >&2
    exit 1
  fi
  random_secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
  database_password=$(random_secret)
  app_secret=$(random_secret)
  two_factor_key=$(random_secret)
  temporary=$(mktemp .local/liekan-env.XXXXXX)
  cat > "$temporary" <<EOF
POSTGRES_USER=liekan
POSTGRES_DB=liekan
POSTGRES_PASSWORD=$database_password
DATABASE_URL=postgresql://liekan:$database_password@127.0.0.1:15435/liekan
APP_SECRET=$app_secret
TWO_FACTOR_ENCRYPTION_KEY=$two_factor_key
DISABLE_TELEMETRY=1
NEXT_TELEMETRY_DISABLED=1
DEFAULT_LOCALE=zh-CN
API_KEY_ENABLED=1
LIEKAN_AI_ENABLED=false
EOF
  # A hard link installs the configuration atomically without overwriting a file.
  ln "$temporary" .env
  rm -f "$temporary"
  temporary=''
  printf '%s\n' '首次安装配置已生成并保存在私有 .env 中。'
fi

docker compose -f docker-compose.liekan.yml config --quiet
docker compose -f docker-compose.liekan.yml build app
docker compose -f docker-compose.liekan.yml up -d --no-build --wait --wait-timeout 300
printf '%s\n' '猎看统计部署完成：http://127.0.0.1:3002' '首次安装登录：admin / liekan。已有账号使用原密码。' '公网访问通过反向代理配置域名与 HTTPS。'
