import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
function encryptionKey(input: string) {
  const key = Buffer.from(input || '', 'base64');
  if (key.length !== 32) throw new Error('日志凭据加密密钥需要 32 字节');
  return key;
}
export function sealSecret(value: string, key: string, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function openSecret(value: string, key: string, purpose: string) {
  const [version, iv, tag, payload, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !payload || extra) throw new Error('加密记录无效');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(key),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function sealPlatformSecret(value: string, purpose: string) {
  return sealSecret(value, process.env.LIEKAN_LOG_CREDENTIALS_KEY, purpose);
}
export function openPlatformSecret(value: string, purpose: string) {
  const candidates = [
    process.env.LIEKAN_LOG_CREDENTIALS_KEY,
    ...(process.env.LIEKAN_LOG_PREVIOUS_KEYS || '').split(',').filter(Boolean),
  ];
  if (candidates.length > 4) throw new Error('Too many previous credential keys');
  for (const key of candidates) {
    try {
      return openSecret(value, key, purpose);
    } catch {}
  }
  throw new Error('Credential record cannot be decrypted');
}
