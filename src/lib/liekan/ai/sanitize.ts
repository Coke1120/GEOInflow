import { AiError } from './error';

const redacted = '[已脱敏]';
const privatePathKey =
  /^(?:users?|accounts?|profiles?|members?|visitors?|sessions?|customers?|emails?|phones?|tokens?|(?:api[_-]?)?keys?|passwords?|secrets?|credentials?|cookies?|authorization|auth|reset|verify|invite|(?:access|refresh|session|auth|csrf|id|client)[_-]?(?:tokens?|keys?|secrets?)|(?:reset|change|recover|set)[_-]?password|password[_-]?(?:reset|change|recover)|(?:verify|confirm)[_-]?email|activation|activate)$/i;
function redactIdentityPath(path: string): string {
  const parts = path.split('/');
  let privateBranch = false;
  return parts.map(part => {
    const output = privateBranch && part ? redacted : part;
    if(privatePathKey.test(part)) privateBranch = true;
    return output;
  }).join('/');
}
const boundaryCount = (value:string) => (value.match(/[\/\\?#;=:\s"'@<>]|[\p{Cc}\p{Cf}]/gu) ?? []).length;
/** Decoding may reveal an identity, but must never create a new lexical or URI boundary. */
function decoded(value: string) {
  if(/[\p{Cc}\p{Cf}]/u.test(value))return redacted;
  let text = value;
  for (let i = 0; i < 8; i++) {
    if(!/%[a-f0-9]{2}/i.test(text))return text;
    try {
      const next = decodeURIComponent(text);
      if(next === text)return text;
      if(boundaryCount(next)>boundaryCount(text))return redacted;
      text = next;
    } catch { return redacted; }
  }
  return /%[a-f0-9]{2}/i.test(text) ? redacted : text;
}
export function sanitizeAiText(value: unknown, maxLength = 200): string {
  if (typeof value !== 'string') throw new AiError('facts_invalid', '统计数据格式无效', 500);
  if(/[\p{Cc}\p{Cf}]/u.test(value))return redacted;
  // Decode each original token while keeping encoded whitespace inside its privacy scope.
  const normalized = value.replace(/[^\s]+/g, token => decoded(token).replace(/\\/g, '/')
    .replace(/https?:\/\/[\s\S]*/gi,redacted)
    .replace(/\/\/[\s\S]*/g,redacted)
    .replace(/\/[\s\S]*/g,path=>redactIdentityPath(path.split(/[?#;]/,1)[0])));
  return normalized
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, redacted)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, redacted)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, redacted)
    .replace(/(?:\b[0-9a-f]{1,4}:){2,}[0-9a-f:]+(?:%[\w-]+)?/gi, redacted)
    .replace(/::(?:[0-9a-f]{0,4}:)*[0-9a-f]{0,4}/gi, redacted)
    .replace(/(?<![\w])\+?\d[\d ()-]{5,}\d(?![\w])/g, matched =>
      matched.replace(/\D/g, '').length >= 7 ? redacted : matched,
    )
    .replace(
      /\b(?:api[_ -]?key|(?:access|refresh|session|auth|csrf|id|client)[_ -]?(?:token|key|secret)|token|password|secret|cookie|authorization)\s*[:=]\s*[^\s/]+/gi,
      redacted,
    )
    .replace(/\b(?:Bearer\s+\S+|(?:sk|pk|sess|key|token)-[a-z0-9_-]+)\b/gi, redacted)
    .replace(
      /\b(?=[a-z0-9_+-]{24,}\b)(?=[a-z0-9_+-]*\d)(?=[a-z0-9_+-]*[a-z])[a-z0-9_+-]+\b/gi,
      redacted,
    )
    .replace(/[<>]/g, '')
    .slice(0, maxLength);
}
export function cleanAiPath(value: unknown): string {
  if (typeof value !== 'string') throw new AiError('facts_invalid', '统计路径格式无效', 500);
  let path = decoded(value).split(/[?#;]/, 1)[0];
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || !path.startsWith('/'))
    return redacted;
  path = path.replace(/\\/g, '/');
  return redactIdentityPath(path)
    .split('/')
    .map(part => sanitizeAiText(part, 160))
    .join('/')
    .slice(0, 500);
}
export function safeAiCount(value: unknown): number {
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER))
    return Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new AiError('facts_invalid', '统计计数超出支持范围', 500);
  return value;
}
export function aiChangePercent(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) / previous) * 10000) / 100;
}
