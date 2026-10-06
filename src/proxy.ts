import type { NextRequest } from 'next/server';
import { rewriteWebsiteHandle } from '@/lib/liekan/website-handle-proxy';

// Local development proxy: rewrite numeric website handles on upstream API paths.
// The Docker build replaces this file with docker/proxy.ts, which chains the same
// rewrite together with the upstream CSP and collect-endpoint handling.
export async function proxy(request: NextRequest) {
  return rewriteWebsiteHandle(request);
}

export const config = {
  matcher: [
    '/api/websites/:path*',
    '/api/realtime/:path*',
    '/compat/api/websites/:path*',
    '/compat/api/realtime/:path*',
  ],
};
