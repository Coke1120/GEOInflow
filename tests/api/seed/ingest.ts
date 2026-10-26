import { randomUUID } from 'node:crypto';
import { retimeBrowserFixtures, type BrowserFixtureTime } from './retime';
import type { ApiClient, ApiRequestOptions, ApiResponse } from '../client';
import { CACHE_HEADER } from '../helpers/constants';
import type { Dataset, RecordPayload, SendPayload } from './dataset';

export interface IngestResult {
  replay: { sessionId: string; visitId: string };
}

const BATCH_LIMIT = 500;
let seedingDataset = false;
const fixtureTimes = new Map<string, BrowserFixtureTime>();
const fixtureEventIds = new WeakMap<SendPayload, string>();

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
  if (process.env.LIEKAN_API_FIXTURE_CONTAINER && event.payload.website) {
    const timestamp = payload.timestamp;
    delete payload.timestamp;
    if (event.type !== 'identify') {
      let eventId = String(payload.eventId || fixtureEventIds.get(event) || randomUUID());
      fixtureEventIds.set(event, eventId);
      payload.eventId = eventId;
      if (typeof timestamp === 'number')
        fixtureTimes.set(eventId, {
          websiteId: String(payload.website),
          eventId,
          at: timestamp,
          splitVisits: seedingDataset,
        });
    }
  }
  return {
    body: { ...event, payload },
    headers: {
      ...(typeof userAgent === 'string' ? { 'user-agent': userAgent } : {}),
      ...(process.env.LIEKAN_API_FIXTURE_CONTAINER
        ? { 'x-liekan-fixture-ip': String(ip || '192.0.2.1') }
        : {}),
    },
  };
}

export async function sendBrowserFixture(
  api: ApiClient,
  event: SendPayload,
  options: Omit<ApiRequestOptions, 'data'> = {},
) {
  const browser = browserRequest(event);
  const response = await api.post('/api/send', browser.body, {
    ...options,
    headers: { ...options.headers, ...browser.headers },
  });
  const eventId = String(browser.body.payload.eventId || '');
  const time = fixtureTimes.get(eventId);
  if (response.status === 200 && time && !seedingDataset) {
    retimeBrowserFixtures([time]);
    fixtureTimes.delete(eventId);
  }
  return response;
}

/** Receipt IDs keep isolated seed retries atomic during a temporary analytics epoch lock. */
async function seedReceiptWrite(write: () => Promise<ApiResponse>, events: SendPayload[]) {
  for (let attempt = 0; ; attempt++) {
    const response = await write();
    if (
      !seedingDataset ||
      !process.env.LIEKAN_API_FIXTURE_CONTAINER ||
      attempt >= 4 ||
      ![500, 503].includes(response.status) ||
      !events.every(event => event.type !== 'identify' && fixtureEventIds.has(event))
    )
      return response;
    console.log(`Retrying isolated seed receipt write (${attempt + 1}/4)`);
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

async function send(api: ApiClient, event: SendPayload, cache?: string) {
  const response = await seedReceiptWrite(
    () => sendBrowserFixture(api, event, { headers: cache ? { [CACHE_HEADER]: cache } : {} }),
    [event],
  );

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
  seedingDataset = true;
  try {
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
        const response = await seedReceiptWrite(
          () =>
            api.post(
              '/api/batch',
              items.map(event => browserRequest(event).body),
              {
                headers: browserRequest(items[0]).headers,
              },
            ),
          items,
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

    retimeBrowserFixtures([...fixtureTimes.values()]);
    fixtureTimes.clear();
    return { replay: { sessionId: live.sessionId, visitId: live.visitId } };
  } finally {
    seedingDataset = false;
    fixtureTimes.clear();
  }
}
