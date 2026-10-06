import { afterEach, describe, expect, it, vi } from 'vitest';
import ipaddr from 'ipaddr.js';
import snapshots from '../../../../config/liekan/bot-ranges.json';
import { verifyBotIp } from './verify';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('official IP evidence lifetime', () => {
  it('reuses compiled ranges on the hot path and observes changed prefixes', () => {
    vi.useFakeTimers();
    const time = new Date().toISOString();
    const evidence = { GPTBot: { retrievedAt: time, prefixes: ['192.0.2.0/24', '2001:db8::/32'] } };
    const parse = vi.spyOn(ipaddr, 'parseCIDR');
    expect(verifyBotIp('192.0.2.1', 'GPTBot', 'GPTBot', time, evidence)).toBe('verified_range');
    const coldCalls = parse.mock.calls.length;
    for (let n = 0; n < 100; n++)
      expect(verifyBotIp('192.0.2.1', 'GPTBot', 'GPTBot', time, evidence)).toBe('verified_range');
    expect(parse.mock.calls.length).toBe(coldCalls);
    evidence.GPTBot.prefixes[0] = '203.0.113.0/24';
    expect(verifyBotIp('192.0.2.1', 'GPTBot', 'GPTBot', time, evidence)).toBe('range_mismatch');
    expect(verifyBotIp('203.0.113.1', 'GPTBot', 'GPTBot', time, evidence)).toBe('verified_range');
    expect(verifyBotIp('2001:db8::1', 'GPTBot', 'GPTBot', time, evidence)).toBe('verified_range');
    vi.setSystemTime(new Date(Date.now() + 8 * 86400000));
    expect(verifyBotIp('203.0.113.1', 'GPTBot', 'GPTBot', time, evidence)).toBe('unverified');
  });
  it('matches current official ranges, distinguishes mismatches, and expires evidence', () => {
    vi.useFakeTimers();
    const time = snapshots.GPTBot.retrievedAt;
    vi.setSystemTime(new Date(time));
    const ip = snapshots.GPTBot.prefixes[0].split('/')[0];
    expect(verifyBotIp(ip, 'GPTBot', 'GPTBot/1.2', time)).toBe('verified_range');
    expect(verifyBotIp('203.0.113.1', 'GPTBot', 'GPTBot/1.2', time)).toBe('range_mismatch');
    expect(verifyBotIp(ip, 'GPTBot', 'Custom impersonator', time)).toBe('unverified');
    expect(verifyBotIp(ip, 'GPTBot', 'GPTBot/1.2', '2020-01-01')).toBe('unverified');
    vi.setSystemTime(new Date(new Date(time).getTime() + 8 * 86400000));
    expect(verifyBotIp(ip, 'GPTBot', 'GPTBot/1.2', time)).toBe('unverified');
  });
});
