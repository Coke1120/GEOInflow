import { api } from '@/lib/liekan/http';
import { authenticateCrawlerMaintenance } from '@/lib/liekan/upstream/crawler-maintenance';
import { authorizeCrawlerRegistryReader } from '@/lib/liekan/upstream/crawler-registry';
import { withPublishedRegistry } from '@/lib/liekan/upstream/crawler-registry-context';

export async function GET(request: Request) {
  return api(async () => {
    await authorizeCrawlerRegistryReader(await authenticateCrawlerMaintenance(request));
    return withPublishedRegistry(catalog => catalog);
  }, undefined, request);
}
