import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export type AiKeyBinding = {
  connectionId: string;
  space: { kind: 'personal' | 'team'; id: string };
};
export type AiEncryptionKey = string | Buffer;
const uuid = z.uuid();
const base64 = (bytes?: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]*$/)
    .refine(value => {
      const decoded = Buffer.from(value, 'base64url');
      return (
        decoded.toString('base64url') === value && (bytes === undefined || decoded.length === bytes)
      );
    });
export const aiKeyEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  keyId: z.string().regex(/^[a-f0-9]{16}$/),
  iv: base64(12),
  ciphertext: base64().refine(value => {
    const length = Buffer.from(value, 'base64url').length;
    return length > 0 && length <= 4096;
  }),
  tag: base64(16),
});
export type AiKeyEnvelope = z.infer<typeof aiKeyEnvelopeSchema>;

export class AiCredentialError extends Error {
  readonly code = 'credential_unavailable';
  constructor() {
    super('AI 凭证暂不可用，请检查加密配置或重新保存凭证。');
    this.name = 'AiCredentialError';
  }
}

function keyBytes(supplied?: AiEncryptionKey): Buffer {
  const value = supplied ?? process.env.LIEKAN_AI_ENCRYPTION_KEY;
  if (Buffer.isBuffer(value) && value.length === 32) return Buffer.from(value);
  if (typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value))
    return Buffer.from(value, 'hex');
  throw new AiCredentialError();
}
function keyId(key: Buffer) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
function aad(binding: AiKeyBinding) {
  uuid.parse(binding.connectionId);
  uuid.parse(binding.space.id);
  if (!['personal', 'team'].includes(binding.space.kind)) throw new AiCredentialError();
  return Buffer.from(
    JSON.stringify([
      1,
      binding.connectionId.toLowerCase(),
      binding.space.kind,
      binding.space.id.toLowerCase(),
    ]),
  );
}

export function getAiModuleState(env: Readonly<Record<string, string | undefined>> = process.env):
  | { enabled: true; keyId: string }
  | {
      enabled: false;
      reason: 'feature_disabled' | 'encryption_key_missing' | 'encryption_key_invalid';
    } {
  if (env.LIEKAN_AI_ENABLED !== 'true') return { enabled: false, reason: 'feature_disabled' };
  if (!env.LIEKAN_AI_ENCRYPTION_KEY) return { enabled: false, reason: 'encryption_key_missing' };
  try {
    return { enabled: true, keyId: keyId(keyBytes(env.LIEKAN_AI_ENCRYPTION_KEY)) };
  } catch {
    return { enabled: false, reason: 'encryption_key_invalid' };
  }
}

export function encryptAiKey(
  plaintext: string,
  binding: AiKeyBinding,
  supplied?: AiEncryptionKey,
): AiKeyEnvelope {
  try {
    const input = Buffer.from(plaintext, 'utf8');
    if (!input.length || input.length > 4096) throw new AiCredentialError();
    const key = keyBytes(supplied);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(binding));
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    return {
      version: 1,
      keyId: keyId(key),
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
  } catch {
    throw new AiCredentialError();
  }
}

export function decryptAiKey(
  envelope: unknown,
  binding: AiKeyBinding,
  supplied?: AiEncryptionKey,
): string {
  try {
    const parsed = aiKeyEnvelopeSchema.parse(envelope);
    const key = keyBytes(supplied);
    if (parsed.keyId !== keyId(key)) throw new AiCredentialError();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64url'));
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AiCredentialError();
  }
}
