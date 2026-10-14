export const aiActionLabels: Record<string, string> = {
  'geo-ai': '查看抓取总览',
  'geo-bots': '查看 AI 爬虫',
  'geo-ai-pages': '查看抓取页面',
  'geo-logs': '查看日志监测',
  'geo-sources': '查看来源渠道',
  'geo-content': '查看页面与内容',
  'geo-conversions': '查看转化分析',
  tracking: '检查统计安装',
};

export function aiSpaceDisplayName(
  space: { kind: string; id: string; name: string },
  currentUserId: string | undefined,
  display: (source: string) => string,
) {
  return space.kind === 'personal' && space.id === currentUserId && space.name === '个人空间'
    ? display('个人空间')
    : space.name;
}
