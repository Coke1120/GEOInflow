import { readBody, requestApi } from '@/lib/liekan/http';
import {
  initializeAccountPreferences,
  readAccountPreferences,
  saveAccountPreferences,
} from '@/lib/liekan/upstream/account-preferences';

export async function GET(request: Request) {
  return requestApi(request, () => readAccountPreferences(request));
}

export async function POST(request: Request) {
  return requestApi(request, async () =>
    initializeAccountPreferences(request, await readBody(request, 1024)),
  );
}

export async function PATCH(request: Request) {
  return requestApi(request, async () =>
    saveAccountPreferences(request, await readBody(request, 1024)),
  );
}
