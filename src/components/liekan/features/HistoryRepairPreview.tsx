'use client';
import type { HistoryRepairPreview as Preview } from '@/lib/liekan/contracts/history-repair';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { Definition, Metrics, Notice, Table } from './ui';
import { repairCount, repairDifference, repairLimitationLabels } from './historyRepairUi';
const categories: Record<string, string> = {
  all: '全部',
  training: 'AI 训练',
  search: 'AI 搜索',
  user: '用户触发',
  traditional_search: '传统搜索',
  workbench: 'AI 工作台',
  personal_agent: '个人 Agent',
  other: '其他爬虫',
  unknown: '未识别',
};
export function HistoryRepairPreview({ preview }: { preview: Preview }) {
  const i18n = useLiekanI18n();
  const n = (value: unknown) => i18n.system(repairCount(value, i18n.locale));
  const logs = preview.logImpact;
  return (
    <>
      <Metrics
        items={[
          [i18n.text('修复前浏览 PV'), n(preview.counts.beforePV)],
          [i18n.text('修复后浏览 PV'), n(preview.counts.afterPV)],
          [i18n.text('修复前访客 UV'), n(preview.counts.beforeUV)],
          [i18n.text('修复后访客 UV'), n(preview.counts.afterUV)],
        ]}
      />
      <Definition
        items={[
          [
            i18n.text('新增排除浏览 PV'),
            repairDifference(preview.counts.beforePV, preview.counts.afterPV, i18n.locale),
          ],
          [
            i18n.text('浏览可重识别覆盖'),
            preview.browserCoverage == null
              ? i18n.text('未提供')
              : `${Math.round(preview.browserCoverage * 100)}%`,
          ],
          [
            i18n.text('日志 UA 覆盖'),
            preview.logCoverage == null
              ? i18n.text('未提供')
              : `${Math.round(preview.logCoverage * 100)}%`,
          ],
          [i18n.text('爬虫分类修正记录'), n(preview.counts.changedLogs)],
          [i18n.text('缺少日期的历史事件'), n(preview.counts.undatedEvents)],
          [i18n.text('固定任务时区'), preview.timezone],
          [
            i18n.text('爬虫规则版本'),
            <span title={preview.rulepack.hash}>{preview.rulepack.hash.slice(0, 16)}</span>,
          ],
        ]}
      />
      <Notice>
        {i18n.text(
          '对比针对固定接收范围，跨日 UV 已独立去重。当前报表可能包含新流量；GEO 权重继续使用原始归档核验证据。',
        )}
      </Notice>
      {logs && (
        <>
          <Table
            columns={['日志分类', '修复前请求', '修复后请求']}
            numeric={[1, 2]}
            rows={logs.categories.map(item => [
              i18n.system(categories[item.category] || '未识别'),
              n(item.beforeRequests),
              n(item.afterRequests),
            ])}
          />
          <Definition
            items={[
              [i18n.text('修复前已识别身份'), n(logs.beforeIdentities)],
              [i18n.text('修复后已识别身份'), n(logs.afterIdentities)],
              [i18n.text('修复前 AI 覆盖页面'), n(logs.beforeAiPages)],
              [i18n.text('修复后 AI 覆盖页面'), n(logs.afterAiPages)],
            ]}
          />
          <p className="metric-note">
            {i18n.text(
              '用途与产品形态可交叉，分类请求数不相加为总量。页面按固定日志范围的路径去重。',
            )}
          </p>
        </>
      )}
      {preview.limitations.map(reason => (
        <Notice key={reason} tone="amber">
          {i18n.system(
            repairLimitationLabels[reason] || '该部分历史证据不足，详细范围请查看修复记录。',
          )}
        </Notice>
      ))}
    </>
  );
}
