import { afterEach, describe, expect, it, vi } from 'vitest';
import snapshots from '../../../../config/liekan/bot-ranges.json';
import { verifyBotIp } from './verify';

afterEach(() => vi.useRealTimers());
describe('official IP evidence lifetime', () => {
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
