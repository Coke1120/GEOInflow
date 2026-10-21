import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as networkFetch } from 'undici';

export function publicSourceAddress(value: string) {
  try {
    return ipaddr.process(value).range() === 'unicast';
  } catch {
    return false;
  }
}
export function approvedSourceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
      !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname))
    throw new Error('invalid_source_destination');
  return url;
}

/** Pin the validated DNS answer to the socket; redirects never trigger another destination. */
export const safeSourceFetch: typeof fetch = async (input, init) => {
  const url = approvedSourceUrl(String(input));
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(answer => !publicSourceAddress(answer.address)))
    throw new Error('non_public_source_destination');
  if (init?.signal?.aborted) throw new Error('source_request_aborted');
  const agent = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const family = typeof options === 'number' ? options : options.family;
        const eligible = answers.filter(answer => !family || answer.family === family);
        if (!eligible.length) return callback(new Error('source_address_family'), '', 0);
        if (typeof options === 'object' && options.all) return callback(null, eligible);
        callback(null, eligible[0].address, eligible[0].family);
      },
    },
  });
  try {
    const response = await networkFetch(url, { ...init, redirect: 'error', dispatcher: agent } as Parameters<typeof networkFetch>[1]);
    // Graceful close drains the response body; the caller's deadline also cancels its stream.
    void agent.close().catch(() => agent.destroy());
    return response as unknown as Response;
  } catch (error) {
    await agent.destroy();
    throw error;
  }
};
