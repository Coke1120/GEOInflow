import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
export const operations = [
  logSourceOperation(
    'get',
    '/api/liekan/oauth/cloudflare/callback',
    'callbackLiekanCloudflare',
    'none',
    undefined,
    { redirect: true },
  ),
] as const;
