import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { readDockerManifest } from './assets';
import { publicUrl } from './service';
import { LiekanError } from '../upstream/errors';

export function dockerInstallCommand(
  url: string,
  websiteId: string,
  checksum: string,
  code?: string,
) {
  const arguments_ = `--url '${url}' --website '${websiteId}'${code ? ` --code '${code}'` : ''}`;
  return `d=$(mktemp -d) && curl -fsSL --proto '=https' --tlsv1.2 '${url}/liekan-agent/install-docker.sh' -o "$d/install.sh" && printf '%s  %s\\n' '${checksum}' "$d/install.sh" | sha256sum -c - && if [ "$(id -u)" -eq 0 ]; then sh "$d/install.sh" ${arguments_}; else sudo sh "$d/install.sh" ${arguments_}; fi`;
}

export async function dockerDeployment(websiteId: string) {
  const manifest = await readDockerManifest().catch(() => {
    throw new LiekanError('Docker 部署包尚未准备完成，请联系部署管理员', 503);
  });
  const url = publicUrl();
  const zip = await JSZip.loadAsync(
    await readFile(resolve('public/liekan-agent', manifest.docker!.zipFile)),
  );
  const start = `#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec sh ./install.sh --url '${url}' --website '${websiteId}' "$@"\n`;
  zip.file('start.sh', start, { unixPermissions: 0o755 });
  zip.file(
    'README.txt',
    [
      '猎看 Docker 日志采集器',
      `网站标识：${websiteId}`,
      `统计服务：${url}`,
      '',
      '1. 上传并解压到公开访问目录之外，例如 /opt/liekan-agent-package。',
      '2. 在宝塔管理员终端进入解压目录，执行：sh start.sh；普通账户执行 sudo sh start.sh。',
      '3. 按提示填写当前网站访问日志路径，通常在 /www/wwwlogs/。',
      '4. 等待日志、容器和网络检查通过，再回到后台生成 Docker 安装命令，复制其中显示的配对码并输入。',
      '5. 返回后台重新检查连接、真实日志接收和 AI 蜘蛛匹配。',
      '',
      '下载包不含配对码或长期接收凭据。配对码有效期 10 分钟且仅能使用一次。',
      '运行环境：Linux x64/arm64、可用的 Docker Engine、Docker Compose V2。',
      '部署文件位于 /opt/liekan-agent-docker/<网站标识>；缓存和进度保存在 Docker 持久卷。',
      '容器只读挂载所选日志目录，仅通过 HTTPS 向统计服务发送数据。',
      '日志路径、文件名支持字母、数字、点、下划线、短横线和斜线。',
      '同一网站重复安装和升级保留原配对与采集进度。',
      '停止：管理员终端执行 sh start.sh --stop。持久卷和配置继续保留。',
      '首次采集从启动后的新增日志开始；历史日志请使用手动导入。',
    ].join('\n'),
  );
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    platform: 'UNIX',
  });
  return {
    fileName: `liekan-agent-${websiteId}.zip`,
    archive: archive.toString('base64'),
    command: dockerInstallCommand(url, websiteId, manifest.docker!.installerSha256),
    version: manifest.version,
  };
}
