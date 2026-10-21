import { readBody, requestApi } from '@/lib/liekan/http';
import { authenticateHistoryRepair } from '@/lib/liekan/upstream/history-repair-api';
import {
  dismissHistoryRepairNotice,
  listHistoryRepair,
} from '@/lib/liekan/upstream/history-repair';

export async function GET(request: Request) {
  return requestApi(request, async () =>
    listHistoryRepair(await authenticateHistoryRepair(request), new URL(request.url).searchParams),
  );
}

export async function PUT(request: Request) {
  return requestApi(request, async () => {
    const identity = await authenticateHistoryRepair(request);
    return dismissHistoryRepairNotice(await readBody(request, 8192), identity);
  });
}
