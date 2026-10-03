function isDecimalText(value: string): value is `${number}` {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
}
export function formatRevenueAmount(value: unknown, currency: string) {
  if (typeof value === 'string') {
    const text = value.trim();
    return isDecimalText(text)
      ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(text)
      : '—';
  }
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value))
    ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(value)
    : '—';
}
function decimalParts(value: unknown) {
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'bigint' || typeof value === 'string'
        ? String(value).trim()
        : '';
  if (!isDecimalText(text)) return null;
  const [mantissa, power = '0'] = text.toLowerCase().split('e');
  const exponent = Number(power);
  if (Math.abs(exponent) > 1000) return null;
  const [whole, fraction = ''] = mantissa.replace(/^[+-]/, '').split('.');
  const scale = fraction.length - exponent;
  const coefficient = BigInt((whole || '0') + fraction) * (text.startsWith('-') ? -1n : 1n);
  return scale < 0
    ? { coefficient: coefficient * 10n ** BigInt(-scale), scale: 0 }
    : { coefficient, scale };
}
function decimalText(coefficient: bigint, scale: number) {
  const sign = coefficient < 0n ? '-' : '';
  const digits = (coefficient < 0n ? -coefficient : coefficient)
    .toString()
    .padStart(scale + 1, '0');
  return sign + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}
export function sumRevenueAmounts(values: unknown[]) {
  let coefficient = 0n,
    scale = 0;
  for (const value of values) {
    const part = decimalParts(value);
    if (!part) continue;
    const nextScale = Math.max(scale, part.scale);
    coefficient =
      coefficient * 10n ** BigInt(nextScale - scale) +
      part.coefficient * 10n ** BigInt(nextScale - part.scale);
    scale = nextScale;
  }
  return decimalText(coefficient, scale);
}
export function formatRevenueAverage(value: unknown, count: number, currency: string) {
  const part = decimalParts(value);
  if (!part || !Number.isSafeInteger(count) || count <= 0) return '—';
  const precision = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits;
  const negative = part.coefficient < 0n;
  const numerator = (negative ? -part.coefficient : part.coefficient) * 10n ** BigInt(precision);
  const denominator = 10n ** BigInt(part.scale) * BigInt(count);
  let rounded = numerator / denominator;
  if ((numerator % denominator) * 2n >= denominator) rounded++;
  return formatRevenueAmount(decimalText(negative ? -rounded : rounded, precision), currency);
}
