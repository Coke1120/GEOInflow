import { describe, expect, it } from 'vitest';
import { decryptAiKey, encryptAiKey, getAiModuleState } from './crypto';

const binding = {
  connectionId: '09cfb153-5a7b-4dce-b607-c61a0d0794c7',
  space: { kind: 'personal' as const, id: '4bde98b2-536c-43b2-a11b-b2b6dba18794' },
};
const key = '12'.repeat(32);
describe('AI credential encryption public seam', () => {
  it('stores a randomized serializable envelope and recovers the credential', () => {
    const first = encryptAiKey('provider-secret', binding, key);
    const second = encryptAiKey('provider-secret', binding, key);
    expect(first).not.toEqual(second);
    expect(JSON.stringify(first)).not.toContain('provider-secret');
    expect(decryptAiKey(JSON.parse(JSON.stringify(first)), binding, key)).toBe('provider-secret');
  });
});
describe('credential binding and module availability', () => {
  it('rejects a credential moved to another connection, space, or key', () => {
    const envelope = encryptAiKey('never-echo-this-secret', binding, key);
    const others = [
      { ...binding, connectionId: '48daa32b-98b1-4c68-a640-d487696180e7' },
      { ...binding, space: { ...binding.space, kind: 'team' as const } },
      { ...binding, space: { ...binding.space, id: 'b1b028a0-eaab-4464-aefa-c69261ae08ea' } },
    ];
    for (const other of others)
      expect(() => decryptAiKey(envelope, other, key)).toThrow(/AI 凭证暂不可用/);
    expect(() => decryptAiKey(envelope, binding, '13'.repeat(32))).toThrow(/AI 凭证暂不可用/);
    expect(() =>
      decryptAiKey(
        { ...envelope, ciphertext: Buffer.from('tampered').toString('base64url') },
        binding,
        key,
      ),
    ).toThrow(/AI 凭证暂不可用/);
    expect(() => decryptAiKey({ ...envelope, iv: 'invalid' }, binding, key)).toThrow(
      /AI 凭证暂不可用/,
    );
  });
  it('allows explicit offline rotation and enforces the UTF-8 byte limit', () => {
    const oldEnvelope = encryptAiKey('轮换凭证', binding, key);
    const nextKey = '34'.repeat(32);
    const rotated = encryptAiKey(decryptAiKey(oldEnvelope, binding, key), binding, nextKey);
    expect(decryptAiKey(rotated, binding, nextKey)).toBe('轮换凭证');
    expect(() => encryptAiKey('x'.repeat(4096), binding, key)).not.toThrow();
    expect(() => encryptAiKey('密'.repeat(1366), binding, key)).toThrow(/AI 凭证暂不可用/);
    expect(() => encryptAiKey('', binding, key)).toThrow(/AI 凭证暂不可用/);
  });
  it('disables AI safely for absent or malformed encryption configuration', () => {
    expect(getAiModuleState({})).toEqual({ enabled: false, reason: 'feature_disabled' });
    expect(getAiModuleState({ LIEKAN_AI_ENABLED: 'TRUE', LIEKAN_AI_ENCRYPTION_KEY: key })).toEqual({
      enabled: false,
      reason: 'feature_disabled',
    });
    expect(getAiModuleState({ LIEKAN_AI_ENABLED: 'true' })).toEqual({
      enabled: false,
      reason: 'encryption_key_missing',
    });
    for (const bad of ['a'.repeat(63), 'z'.repeat(64), ' a'.repeat(32)])
      expect(
        getAiModuleState({ LIEKAN_AI_ENABLED: 'true', LIEKAN_AI_ENCRYPTION_KEY: bad }),
      ).toEqual({ enabled: false, reason: 'encryption_key_invalid' });
    expect(getAiModuleState({ LIEKAN_AI_ENABLED: 'true', LIEKAN_AI_ENCRYPTION_KEY: key })).toEqual({
      enabled: true,
      keyId: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
  });
});
it('binds UUID identity independently from hexadecimal letter case', () => {
  const upper = {
    connectionId: binding.connectionId.toUpperCase(),
    space: { ...binding.space, id: binding.space.id.toUpperCase() },
  };
  expect(decryptAiKey(encryptAiKey('credential', upper, key), binding, key)).toBe('credential');
  expect(decryptAiKey(encryptAiKey('credential', binding, key), upper, key)).toBe('credential');
});
