import { timingSafeEqual } from 'node:crypto';
import { hash, secret } from '@/lib/crypto';
import { checkPassword, hashPassword } from '@/lib/password';
import { LiekanError } from './errors';
export function hasSharePassword(parameters: any) {
  return !!(parameters?.passwordHash || parameters?.password);
}
export function sharePasswordProof(parameters: any) {
  return hasSharePassword(parameters)
    ? hash(secret(), String(parameters.passwordHash || parameters.password))
    : null;
}
export function publicShareParameters(parameters: any = {}) {
  const { password, passwordHash, ...safe } = parameters || {};
  return { ...safe, hasPassword: hasSharePassword(parameters) };
}
export function secureShareParameters(input: any = {}, previous: any = {}) {
  const { password, passwordHash, hasPassword, ...safe } = input || {};
  const stored = previous?.passwordHash || previous?.password;
  if (password === null) return safe;
  if (typeof password === 'string' && password) {
    if (Buffer.byteLength(password) > 72) throw new LiekanError('分享密码上限 72 字节');
    return { ...safe, passwordHash: hashPassword(password) };
  }
  if (password != null && typeof password !== 'string') throw new LiekanError('分享密码格式无效');
  return stored
    ? { ...safe, passwordHash: previous.passwordHash ? stored : hashPassword(String(stored)) }
    : safe;
}
export function verifySharePassword(input: string, parameters: any) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 72) return false;
  if (parameters?.passwordHash) {
    try {
      return checkPassword(input, parameters.passwordHash);
    } catch {
      return false;
    }
  }
  if (!parameters?.password) return true;
  const a = Buffer.from(hash(input)),
    b = Buffer.from(hash(String(parameters.password)));
  return timingSafeEqual(a, b);
}
export function safeManagedShare<T extends { parameters: any }>(share: T): T {
  return share ? { ...share, parameters: publicShareParameters(share.parameters) } : share;
}
