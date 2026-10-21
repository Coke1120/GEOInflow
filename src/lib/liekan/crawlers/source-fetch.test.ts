// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), close: vi.fn().mockResolvedValue(undefined), destroy: vi.fn().mockResolvedValue(undefined), options: undefined as any }));
vi.mock('node:dns/promises', () => ({ lookup: h.lookup, default: { lookup: h.lookup } }));
vi.mock('undici', () => ({ fetch: h.fetch, Agent: class { constructor(options: any) { h.options = options; } close = h.close; destroy = h.destroy; } }));
import { approvedSourceUrl, publicSourceAddress, safeSourceFetch } from './source-fetch';
beforeEach(() => { vi.clearAllMocks(); h.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); h.fetch.mockResolvedValue(new Response('ok')); });
describe('approved source destination boundary', () => {
  it.each(['http://crawler.vendor.com/a', 'https://user:password@crawler.vendor.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://crawler.vendor.com:8443/a', 'https://metadata.internal/a', 'https://crawler.vendor.com/a#x'])('rejects %s before DNS', async url => {
    expect(() => approvedSourceUrl(url)).toThrow();
    await expect(safeSourceFetch(url)).rejects.toThrow(); expect(h.lookup).not.toHaveBeenCalled();
  });
  it.each(['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])('rejects non-public address %s', value => expect(publicSourceAddress(value)).toBe(false));
  it('rejects a mixed public/private DNS answer without starting a request', async () => {
    h.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 },{ address: '10.0.0.1', family: 4 }]);
    await expect(safeSourceFetch('https://crawler.vendor.com/feed')).rejects.toThrow('non_public'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('pins the checked addresses and forbids redirects, including caller overrides', async () => {
    await safeSourceFetch('https://crawler.vendor.com/feed', { redirect: 'follow' });
    const callback = vi.fn(); h.options.connect.lookup('crawler.vendor.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
    expect(h.lookup).toHaveBeenCalledTimes(1); expect(h.fetch.mock.calls[0][1].redirect).toBe('error'); expect(h.close).toHaveBeenCalled();
  });
  it('destroys the pinned connection after a failed request', async () => {
    h.fetch.mockRejectedValue(new Error('network')); await expect(safeSourceFetch('https://crawler.vendor.com/feed')).rejects.toThrow('network'); expect(h.destroy).toHaveBeenCalled();
  });
});
