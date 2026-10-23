import { api } from '@/lib/liekan/http';
import { readCacheManifest } from '@/lib/liekan/upstream/cache-manifest';

export async function GET(request: Request) {
  return api(() => readCacheManifest(request));
}
