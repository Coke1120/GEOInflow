import { api, readBody } from '@/lib/liekan/http';
import { authenticateCrawlerMaintenance } from '@/lib/liekan/upstream/crawler-maintenance';
import { crawlerRegistry, mutateCrawlerRegistry } from '@/lib/liekan/upstream/crawler-registry';

export async function GET(request: Request) {
  return api(async () => crawlerRegistry(await authenticateCrawlerMaintenance(request)));
}
export async function POST(request: Request) {
  return api(async () => {
    const actor = await authenticateCrawlerMaintenance(request);
    return mutateCrawlerRegistry(actor, await readBody(request, 4 * 1024 * 1024));
  });
}
