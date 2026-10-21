import type { ApiClient, ApiRequestOptions } from '../client';
import { CACHE_HEADER } from '../helpers/constants';
import type { Dataset, RecordPayload, SendPayload } from './dataset';

export interface IngestResult {
  replay: { sessionId: string; visitId: string };
}

const BATCH_LIMIT = 500;

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

/** Send browser fixture metadata through its actual request headers. */
function browserRequest(event: SendPayload) {
  const { ip, userAgent, browser, os, device, ...payload } = event.payload;
  return {
    body: { ...event, payload },
    headers: typeof userAgent === 'string' ? { 'user-agent': userAgent } : {},
  };
}

export function sendBrowserFixture(
  api: ApiClient,
  event: SendPayload,
  options: Omit<ApiRequestOptions, 'data'> = {},
) {
  const browser = browserRequest(event);
  return api.post('/api/send', browser.body, {
    ...options,
    headers: { ...options.headers, ...browser.headers },
  });
}

async function send(api: ApiClient, event: SendPayload, cache?: string) {
  const response = await sendBrowserFixture(api, event, {
    headers: cache ? { [CACHE_HEADER]: cache } : {},
  });

  if (response.status !== 200) {
    throw new Error(`POST /api/send failed (${response.status}): ${response.text}`);
  }

  if (response.body?.beep) {
    throw new Error(
      'POST /api/send classified the request as a bot. Start the server with DISABLE_BOT_CHECK=1.',
    );
  }

  if (!response.body?.cache) {
    throw new Error(`POST /api/send returned no cache token: ${response.text}`);
  }

  return response.body as { cache: string; sessionId: string; visitId: string };
}

async function record(api: ApiClient, payload: RecordPayload, cache: string, userAgent: string) {
  const response = await api.post('/api/record', payload, {
    headers: { [CACHE_HEADER]: cache, 'user-agent': userAgent },
  });

  if (response.status !== 200 || response.body?.ok !== true) {
    throw new Error(
      `POST /api/record (${payload.type}) failed (${response.status}): ${response.text}`,
    );
  }
}

export async function ingestDataset(api: ApiClient, dataset: Dataset): Promise<IngestResult> {
  for (const visit of dataset.visits) {
    let cache: string | undefined;

    for (const event of visit.events) {
      cache = (await send(api, event, cache)).cache;
    }
  }

  const batches = new Map<string, SendPayload[]>();
  for (const event of dataset.batch) {
    const userAgent = String(event.payload.userAgent || '');
    batches.set(userAgent, [...(batches.get(userAgent) || []), event]);
  }
  for (const events of batches.values())
    for (const items of chunk(events, BATCH_LIMIT)) {
      const response = await api.post(
        '/api/batch',
        items.map(event => browserRequest(event).body),
        {
          headers: browserRequest(items[0]).headers,
        },
      );

      if (response.status !== 200) {
        throw new Error(`POST /api/batch failed (${response.status}): ${response.text}`);
      }

      if (response.body?.errors) {
        throw new Error(
          `POST /api/batch reported ${response.body.errors} error(s): ${JSON.stringify(
            response.body.details?.slice(0, 3),
          )}`,
        );
      }
    }

  const live = await send(api, dataset.replay.pageview);

  const replayAgent = String(dataset.replay.pageview.payload.userAgent);
  await record(api, dataset.replay.record, live.cache, replayAgent);
  await record(api, dataset.replay.heatmap, live.cache, replayAgent);

  for (const event of dataset.realtime) {
    await send(api, event);
  }

  return { replay: { sessionId: live.sessionId, visitId: live.visitId } };
}
