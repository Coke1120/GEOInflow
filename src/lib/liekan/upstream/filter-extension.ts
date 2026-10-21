import { getAiReferralRules, searchAliases, nonSearchMedia } from '../contracts/sources';

// SQL expressions use the same fixed source catalog as the product classifier.
export function channelFilterColumn(prefix = 'website_event.') {
  const source = `LOWER(TRIM(COALESCE(${prefix}utm_source,'')))`;
  const medium = `LOWER(TRIM(COALESCE(${prefix}utm_medium,'')))`;
  const referrer = `LOWER(TRIM(COALESCE(${prefix}referrer_domain,'')))`;
  const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const inValues = (expr: string, values: string[]) =>
    `${expr} IN (${values.map(literal).join(',')})`;
  const domain = (expr: string, values: string[]) =>
    values
      .map(d => `(${expr}=${literal(d)} OR RIGHT(${expr},${d.length + 1})=${literal(`.${d}`)})`)
      .join(' OR ');
  const ai = (expr: string, aliases: boolean) => getAiReferralRules().map(rule => {
    const matches = [`${expr}=${literal(rule.host)}`];
    if (rule.includeSubdomains) matches.push(`RIGHT(${expr},${rule.host.length + 1})=${literal(`.${rule.host}`)}`);
    if (aliases && rule.aliases.length) matches.push(inValues(expr, rule.aliases.map(alias => alias.toLowerCase())));
    return `(${matches.join(' OR ')})`;
  }).join(' OR ') || 'FALSE';
  const classify = (expr: string, aliases: boolean) =>
    `CASE WHEN (${ai(expr, aliases)}) THEN 'AI 搜索引荐' WHEN (${aliases ? `${inValues(expr, Object.keys(searchAliases))} OR ` : ''}${domain(expr, Object.values(searchAliases))}) THEN '传统搜索' ELSE '其他引荐' END`;
  return `(CASE WHEN ${source}<>'' OR ${medium}<>'' THEN CASE WHEN ${inValues(medium, [...nonSearchMedia])} OR ${source}='' THEN '其他引荐' ELSE ${classify(source, true)} END WHEN ${referrer}='' OR ${referrer}='直接访问' THEN '直接访问' ELSE ${classify(referrer, false)} END)`;
}
