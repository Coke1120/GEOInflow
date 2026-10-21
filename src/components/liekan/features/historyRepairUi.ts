import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { historyRepairEvidenceRecordSchema } from '@/lib/liekan/contracts/history-repair';
import type { HistoryRepairStatus } from '@/lib/liekan/contracts/history-repair';

export const repairStatusLabels: Record<HistoryRepairStatus, string> = {
  unscanned: '待扫描',
  scanning: '扫描中',
  preparing: '正在准备预览',
  ready: '待确认',
  queued: '排队中',
  running: '处理中',
  validating: '校验中',
  completed: '已完成',
  completed_limited: '已完成且有证据不足',
  unchanged: '无需变更',
  unidentifiable: '暂无法重识别',
  empty: '无历史数据',
  paused: '已暂停',
  failed: '失败',
  cancelled: '已取消',
  rolled_back: '已回退',
  expired: '预览已过期',
  invalidated: '已失效',
};
export const runningRepairStatuses = new Set<HistoryRepairStatus>([
  'scanning',
  'preparing',
  'queued',
  'running',
  'validating',
]);
export function repairCount(value: unknown, locale: string) {
  if (value == null || value === '') return '未提供';
  try {
    return BigInt(String(value)).toLocaleString(locale);
  } catch {
    return '未提供';
  }
}
export function repairDifference(before: unknown, after: unknown, locale: string) {
  try {
    return (BigInt(String(before)) - BigInt(String(after))).toLocaleString(locale);
  } catch {
    return '未提供';
  }
}

/** Bounded decoding keeps complete request agents out of errors and persisted state. */
export async function* historyEvidenceRecords(file: File) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '',
    line = 0;
  const parse = (source: string) => {
    line++;
    if (!source.trim()) return undefined;
    if (source.length > 16384) throw new Error(`第 ${line} 行超出证据记录上限`);
    try {
      return historyRepairEvidenceRecordSchema.parse(JSON.parse(source));
    } catch {
      throw new Error(`第 ${line} 行证据格式无效`);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      try {
        pending += decoder.decode(value, { stream: !done });
      } catch {
        throw new Error('证据文件须为有效的 UTF-8 文本');
      }
      let index: number;
      while ((index = pending.indexOf('\n')) >= 0) {
        const row = parse(pending.slice(0, index).replace(/^\uFEFF/, ''));
        pending = pending.slice(index + 1);
        if (row) yield { record: row, line };
      }
      if (pending.length > 16384) throw new Error(`第 ${line + 1} 行超出证据记录上限`);
      if (done) break;
    }
    if (pending.trim()) {
      const row = parse(pending);
      if (row) yield { record: row, line };
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function* historyEvidenceRows(file: File) {
  for await (const item of historyEvidenceRecords(file)) yield item.record;
}

export async function repairActionId(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const repairLimitationLabels: Record<string, string> = {
  'undated-events': '缺少事件时间的记录单列审计，不推测自然日归属。',
  'browser-input-incomplete': '部分历史浏览记录缺少 UA 或精确事件关联，保持原有判定。',
  'log-input-incomplete': '部分历史日志缺少可用于重新识别的 UA。',
  'missing-quality-scan-time-only':
    '部分浏览事件没有采集时质量判定，按本次扫描可见范围单列，当前统计过滤继续有效。',
  'evidence-conflicts-retained': '部分证据相互冲突，冲突记录保留并等待补充。',
  'excluded-old-batches': '部分旧导入批次未能完成，已列入未处理范围。',
  'bot-check-disabled': '当前环境关闭了浏览爬虫检测，浏览证据的识别能力受限。',
};
export const repairErrorLabels: Record<string, string> = {
  'history-repair-evidence-expired': '证据文件已过期，请重新上传原文件',
  'history-repair-revision-conflict': '候选结果已更新，请重新读取并核对预览。',
  'history-repair-scope-changed': '历史输入发生变化，请重新生成预览。',
  'history-repair-snapshot-changed': '网站权限或统计规则发生变化，请重新扫描并预览。',
  'history-repair-engine-changed': '后台处理版本已变化，请重新扫描。',
  'history-repair-query-timeout': '本轮处理超时，进度已保留，可以重试。',
  'history-repair-worker-failed': '后台处理暂时失败，进度已保留，可以重试。',
  'history-repair-idle-expired': '预览已过期，请重新扫描。',
  'history-repair-scan-required': '请重新扫描历史数据。',
  'history-repair-preview-changed': '预览结果发生变化，请重新读取并确认。',
  'history-repair-partial-confirmation-required': '请核对并确认证据不足的范围。',
  'waiting-old-batches': '正在等待旧导入批次结束。',
  'evidence-changed': '补充证据已变化，请重新生成预览。',
  'active-scope-gap': '旧版服务继续写入了历史范围，请完成服务升级后重新检查。',
};
export const repairAuditLabels: Record<string, string> = {
  scan: '扫描历史数据',
  preview: '生成预览',
  confirm: '确认修复',
  pause: '暂停任务',
  resume: '继续任务',
  retry: '重试任务',
  cancel: '取消任务',
  rollback: '回退修复',
  reactivate: '再次生效',
  activate: '修复生效',
  completed: '修复完成',
  'evidence-append': '接收证据分块',
  'evidence-finalize': '完成证据校验',
  'evidence-discard': '撤下证据文件',
  'evidence-retry': '复用已接收证据分块',
};

export const repairEvidenceErrorLabels: Record<string, string> = {
  'event-not-resolved': '未找到本网站唯一对应的事件或接收凭证。',
  'browser-source-required': '该记录不属于浏览采集来源。',
  'outside-frozen-scope': '该事件不在本次冻结范围内。',
  'event-date-missing': '原事件缺少时间，不能纳入有日期的修复范围。',
  'conflicting-event-evidence': '同一事件已有不同的证据，请修正或撤下冲突文件。',
};

/** Clear only the discarded upload marker; other files remain resumable. */
export function forgetHistoryUpload(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  key: string,
  uploadId: string,
) {
  try {
    const marker = JSON.parse(storage.getItem(key) || 'null');
    if (marker?.uploadId === uploadId) storage.removeItem(key);
  } catch {
    /* Browser storage is optional. */
  }
}

/** Ordered chunk hashes use LF delimiters, including the final LF. */
export function createHistoryManifest() {
  const digest = sha256.create(),
    encoder = new TextEncoder();
  return {
    append: (hash: string) => {
      digest.update(encoder.encode(hash + '\n'));
    },
    finish: () => bytesToHex(digest.digest()),
  };
}
