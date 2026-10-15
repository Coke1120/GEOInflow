/** Display-only explanations; recognition and trust decisions use the recorded evidence. */
export function verificationReasonLabel(reason?: unknown) {
  return (
    {
      no_official_source: '没有已接入的官方范围',
      untrusted_ip: 'IP 来源尚未建立信任',
      ambiguous_name: '请求声明的名称存在歧义',
      unmapped_identity: '未映射官方身份',
      missing_snapshot: '缺少合格范围记录',
      invalid_snapshot: '范围记录无效',
      stale_snapshot: '范围证据已过期',
      range_mismatch: '未匹配该名称的官方范围',
      verified_range: '已匹配该名称的官方范围',
      missing_or_stale_snapshot: '历史记录缺少有效范围',
    }[typeof reason === 'string' ? reason : ''] || '历史未记录核验原因'
  );
}
