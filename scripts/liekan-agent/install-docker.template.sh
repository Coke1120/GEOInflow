#!/bin/sh
set -eu
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
usage() { printf '%s\n' '猎看 Docker 采集器：--url HTTPS地址 --website 网站ID [--log 日志绝对路径] [--code 配对码]' '重复安装保留配对和采集进度；--stop 停止容器并保留配置、缓存及历史数据。'; }
url=''; website=''; log=''; code=''; stop=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help) usage; exit 0;;
    --stop) stop=true; shift;;
    --url|--website|--log|--code)
      [ "$#" -ge 2 ] || fail '安装参数缺少值。'
      case "$1" in --url) url="$2";; --website) website="$2";; --log) log="$2";; --code) code="$2";; esac
      shift 2;;
    *) fail '安装参数无效，请使用 --help 查看。';;
  esac
done
case "$website" in *[!a-f0-9-]*|'') fail '网站标识无效。';; esac
[ "${#website}" = 36 ] || fail '网站标识无效。'
[ "$(id -u)" = 0 ] || fail '请在宝塔终端以管理员身份运行，或使用 sudo。'
for tool in docker curl sha256sum tar readlink stat; do command -v "$tool" >/dev/null || fail "缺少 $tool，请先在宝塔安装 Docker 和基础命令。"; done
docker info >/dev/null 2>&1 || fail 'Docker 尚未启动或当前账户无法访问。请在宝塔 Docker 页面检查。'
docker compose version >/dev/null 2>&1 || fail '需要 Docker Compose V2，请在宝塔更新 Docker 编排工具。'
compose_help=$(docker compose up --help 2>/dev/null) || fail '无法读取 Docker 编排功能，请在宝塔检查 Docker。'
case "$compose_help" in *--wait-timeout*) ;; *) fail '当前 Docker Compose 缺少容器就绪检查功能，请在宝塔更新 Docker 编排工具后重试；配对码未使用。';; esac
case "$(docker info --format '{{.Architecture}}')" in x86_64|aarch64|arm64) ;; *) fail '暂时支持 Linux x64 / arm64 Docker。';; esac
[ "$(docker info --format '{{.OSType}}')" = linux ] || fail '需要 Linux Docker 引擎。'
directory="/opt/liekan-agent-docker/$website"
compose_file="$directory/docker-compose.yml"
env_file="$directory/.env"
compose() { docker compose --project-name "liekan-agent-$website" --project-directory "$directory" --env-file "$env_file" -f "$compose_file" "$@"; }
if "$stop"; then
  [ -f "$directory/docker-compose.yml" ] || fail '未找到该网站的 Docker 部署。'
  compose stop
  printf '%s\n' '采集容器已停止，配置和持久卷已保留。后台断开连接可撤销接收权限。'
  exit 0
fi
case "$url" in *[!a-zA-Z0-9./:_-]*|'') fail '接收地址无效。';; https://*) ;; *) fail '需要 HTTPS 接收地址。';; esac
temp=$(mktemp -d)
locked=false
old_stty=''
cleanup() { if [ -n "$old_stty" ]; then stty "$old_stty" </dev/tty 2>/dev/null || true; fi; rm -rf "$temp"; if "$locked"; then rmdir "$directory/.install-lock" 2>/dev/null || true; fi; }
trap cleanup EXIT HUP INT TERM
mkdir -p "$directory"
[ ! -L "$directory" ] || fail '部署目录需要为常规目录。'
[ ! -L /opt/liekan-agent-docker ] && [ ! -L "$directory/.env" ] && [ ! -L "$directory/docker-compose.yml" ] || fail '部署配置需要为常规文件和目录。'
mkdir "$directory/.install-lock" 2>/dev/null || fail '已有安装任务正在执行，请完成后重试。'
locked=true
if [ ! -f "$directory/.env" ] || [ -n "$log" ]; then
  if [ -z "$log" ]; then
    printf '%s\n' '在宝塔「网站 → 当前网站 → 日志」确认访问日志路径，通常位于 /www/wwwlogs/。' >/dev/tty
    printf '当前网站 Combined 访问日志的绝对路径：' >/dev/tty
    IFS= read -r log </dev/tty
  fi
  case "$log" in /*) ;; *) fail '日志需要绝对路径。';; esac
  case "$log" in *[!a-zA-Z0-9_./-]*) fail '日志路径仅支持字母、数字、点、下划线、短横线和斜线。';; esac
  [ -f "$log" ] && [ ! -L "$log" ] || fail '日志需要为本机常规文件。'
  log=$(readlink -f "$log") || fail '无法解析日志路径。'
  case "$log" in /www/wwwroot/*|/home/*|/root/*|/run/*|/tmp/*|/var/tmp/*) fail '请使用网站专用访问日志目录，例如 /www/wwwlogs/ 或 /var/log/；网站根目录和私人目录受到保护。';; esac
  log_directory=$(dirname "$log")
  case "$log_directory" in /|/www|/var|/etc|/opt|/usr|/srv) fail '请使用网站专用日志目录。';; esac
  log_file=$(basename "$log")
  log_gid=$(stat -c '%g' "$log")
  if [ -f "$directory/.env" ]; then
    [ "$(sed -n 's/^LIEKAN_LOG_DIRECTORY=//p' "$directory/.env")" = "$log_directory" ] && [ "$(sed -n 's/^LIEKAN_LOG_FILE=//p' "$directory/.env")" = "$log_file" ] || fail '已有部署绑定了其他日志路径。请保留原配置，使用原日志路径重试。'
  fi
  printf 'LIEKAN_PUBLIC_URL=%s\nLIEKAN_WEBSITE_ID=%s\nLIEKAN_LOG_DIRECTORY=%s\nLIEKAN_LOG_FILE=%s\nLIEKAN_LOG_GID=%s\n' "$url" "$website" "$log_directory" "$log_file" "$log_gid" > "$temp/env"
else
  [ "$(sed -n 's/^LIEKAN_PUBLIC_URL=//p' "$directory/.env")" = "$url" ] || fail '已有部署使用其他接收地址，请保留配置并核对统计服务地址。'
  cp "$directory/.env" "$temp/env"
fi
printf '%s\n' '正在准备 Docker 采集器，配对码将在环境检查通过后使用。'
curl -fsS --proto '=https' --tlsv1.2 --max-time 120 "$url/liekan-agent/agent-docker.tar.gz" -o "$temp/context.tar.gz" || fail '部署包下载失败，请检查统计服务地址和服务器网络。'
printf '%s  %s\n' '__DOCKER_SHA256__' "$temp/context.tar.gz" | sha256sum -c - >/dev/null || fail '部署包校验失败，请重新从后台获取安装命令。'
mkdir "$temp/context"
tar -xzf "$temp/context.tar.gz" -C "$temp/context"
image='liekan-agent:1.0.0-__DOCKER_TAG__'
docker build --tag "$image" "$temp/context" || fail '镜像构建失败，请检查 Docker 版本、内核和官方镜像源的可达性。'
previous=''
if [ -f "$directory/docker-compose.yml" ]; then
  cp "$directory/docker-compose.yml" "$temp/previous.yml"
  previous=$(sed -n 's/^LIEKAN_AGENT_IMAGE=//p' "$directory/.env")
fi
compose_file="$temp/context/docker-compose.yml"
sed '/^LIEKAN_AGENT_IMAGE=/d' "$temp/env" > "$temp/candidate.env"
printf 'LIEKAN_AGENT_IMAGE=%s\n' "$image" >> "$temp/candidate.env"
env_file="$temp/candidate.env"
compose config --quiet || fail '编排配置无效，请保留部署目录并核对 .env。'
compose run --rm -T --no-deps collector preflight || fail '安装检查未通过；配对码未使用。请根据上方提示处理后重试。'
if [ -z "$code" ]; then
  printf '%s\n' '环境已准备。请在网站后台生成 Docker 配对码；已有配对时直接回车。' >/dev/tty
  printf '一次性配对码：' >/dev/tty
  old_stty=$(stty -g </dev/tty)
  stty -echo </dev/tty
  IFS= read -r code </dev/tty || { stty "$old_stty" </dev/tty; fail '配对码读取失败。'; }
  stty "$old_stty" </dev/tty
  old_stty=''
  printf '\n' >/dev/tty
fi
printf '%s\n' "$code" | compose run --rm -T --no-deps collector pair || fail '环境和配置已保留。请生成新的配对码，再运行同一安装命令。'
cp "$temp/context/docker-compose.yml" "$directory/docker-compose.yml.next"
cp "$temp/candidate.env" "$directory/.env.next"
mv "$directory/docker-compose.yml.next" "$directory/docker-compose.yml"
mv "$directory/.env.next" "$directory/.env"
compose_file="$directory/docker-compose.yml"
env_file="$directory/.env"
if ! compose up -d --force-recreate --wait --wait-timeout 60; then
  if [ -n "$previous" ]; then
    cp "$temp/previous.yml" "$directory/docker-compose.yml"
    sed '/^LIEKAN_AGENT_IMAGE=/d' "$directory/.env" > "$temp/env"
    printf 'LIEKAN_AGENT_IMAGE=%s\n' "$previous" >> "$temp/env"
    cp "$temp/env" "$directory/.env"
    compose up -d || true
    fail '升级启动检查失败，已恢复旧镜像；配对配置和采集进度已保留。'
  fi
  fail '启动检查失败。配对配置和缓存已保留，请在宝塔查看容器日志后重试。'
fi
printf '%s\n' 'Docker 采集器已启动。请返回网站后台检查连接和真实日志接收。' "部署目录：$directory" '首次采集从安装后的新增访问开始，历史日志可以手动导入。'
