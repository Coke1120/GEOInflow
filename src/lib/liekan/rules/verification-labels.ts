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
      verified_dns: '已通过官方双向 DNS 核验',
      trusted_cloudflare_identity: '已通过可信 Cloudflare 身份核验',
      identity_conflict: 'UA 与可信边缘身份冲突，保留待核查',
      dns_missing_input: 'DNS 核验缺少有效输入或请求已过期',
      dns_suffix_mismatch: '反向 DNS 未匹配官方域名后缀',
      dns_forward_mismatch: '正向 DNS 未返回原请求 IP',
      dns_timeout: 'DNS 核验超时',
      dns_unavailable: 'DNS 核验暂不可用',
      dns_budget_exhausted: '本批次 DNS 核验预算已用完',
    }[typeof reason === 'string' ? reason : ''] || '历史未记录核验原因'
  );
}
