import { disconnectAiFactsClient } from '../../../src/lib/liekan/upstream/ai-facts-db';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import prisma, { getRawQueryClient } from '../../../src/lib/prisma';
import { aiTransaction } from '../../../src/lib/liekan/upstream/ai-db';
const target = new URL(process.env.DATABASE_URL!);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '15439');
assert.equal(target.pathname, '/liekan_ai_acceptance');
const base = 'http://127.0.0.1:3305';
const fixtureId = randomUUID(),
  username = 'isolated-http-' + fixtureId.slice(0, 8),
  password = randomBytes(24).toString('hex');
const primary: any = getRawQueryClient(prisma.client, { write: true });
await primary.$queryRawUnsafe('SELECT 1');
const passwordHash = await hash(password, 12);
await aiTransaction(tx =>
  tx.execute(
    'INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,$3,\'admin\')',
    fixtureId,
    username,
    passwordHash,
  ),
);
let session: any, websiteId: string | undefined, connection: any, headers: Record<string, string>;
const api = async (path: string, method = 'GET', body?: unknown) =>
  fetch(base + '/api' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const privateResponse = (response: Response) =>
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
try {
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(
    login.status,
    200,
    'HTTP service must authenticate the unique user in the named isolated database',
  );
  session = await login.json();
  assert.equal(session.user.id, fixtureId);
  headers = { 'Content-Type': 'application/json', authorization: 'Bearer ' + session.token };
  const denied = await fetch(base + '/api/liekan/ai/catalog');
  assert.equal(denied.status, 401);
  privateResponse(denied);
  const catalogResponse = await api('/liekan/ai/catalog');
  assert.equal(catalogResponse.status, 200);
  privateResponse(catalogResponse);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.templates.length, 8);
  assert.equal(catalog.module.enabled, true);
  const created = await api('/websites', 'POST', {
    name: 'AI HTTP 验收（隔离示例）',
    domain: 'isolated-ai-http.example',
  });
  assert.equal(created.status, 200);
  websiteId = (await created.json()).id;
  const convResponse = await api('/liekan/ai/conversations', 'POST', { websiteId });
  assert.equal(convResponse.status, 200);
  privateResponse(convResponse);
  const conversation = await convResponse.json();
  const request = {
    clientRequestId: randomUUID(),
    expectedConfigVersion: 1,
    question: '分析这个隔离示例网站的数据接入状态',
    localOnly: true,
    startAt: new Date(Date.now() - 86400000).toISOString(),
    endAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
  };
  const stream = await api(
    '/liekan/ai/conversations/' + conversation.id + '/messages',
    'POST',
    request,
  );
  assert.equal(stream.status, 200);
  privateResponse(stream);
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const events = (await stream.text()).split('\n\n').flatMap(block => {
    const data = block.split('\n').find(line => line.startsWith('data: '));
    return data ? [JSON.parse(data.slice(6))] : [];
  });
  assert.ok(events.length >= 4);
  assert.equal(events[0].type, 'started');
  events.forEach((event, index) => {
    assert.equal(event.protocolVersion, 1);
    assert.equal(event.sequence, index + 1);
    assert.equal(event.runId, events[0].runId);
  });
  const completed = events.find(event => event.type === 'done');
  assert.ok(completed, 'local guidance must commit and emit done');
  assert.equal(completed.data.state, 'completed');
  assert.equal(completed.data.result.origin, 'local');
  assert.equal(completed.data.usage, null);
  const runId = completed.data.id;
  const recovered = await api('/liekan/ai/runs/' + runId);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).state, 'completed');
  const duplicate = await api(
    '/liekan/ai/conversations/' + conversation.id + '/messages',
    'POST',
    request,
  );
  assert.equal(duplicate.status, 200);
  assert.match(duplicate.headers.get('content-type') ?? '', /application\/json/);
  assert.equal((await duplicate.json()).id, runId);
  const mismatch = await api('/liekan/ai/conversations/' + conversation.id + '/messages', 'POST', {
    ...request,
    question: '改变同一请求内容',
  });
  assert.equal(mismatch.status, 409);
  privateResponse(mismatch);
  const history = await api('/liekan/ai/conversations/' + conversation.id + '/messages');
  assert.equal(history.status, 200);
  const messages = await history.json();
  assert.equal(messages.items.length, 1);
  assert.equal(messages.items[0].origin, 'local');
  assert.ok(messages.items[0].contextId);
  const context = await api(
    '/liekan/ai/conversations/' + conversation.id + '/contexts/' + messages.items[0].contextId,
  );
  assert.equal(context.status, 200);
  const snapshot = await context.json();
  assert.equal(snapshot.facts.website.id, websiteId);
  assert.equal(snapshot.facts.coverage, 'unverified');
  const unsafe = await api('/liekan/ai/connections', 'POST', {
    space: { kind: 'personal', id: session.user.id },
    name: '隔离禁止地址',
    provider: 'custom',
    protocol: 'openai-chat',
    baseUrl: 'http://127.0.0.1:3305',
    model: 'fixture',
    apiKey: 'isolated-key',
  });
  assert.equal(unsafe.status, 400);
  const record = await api('/liekan/ai/connections', 'POST', {
    space: { kind: 'personal', id: session.user.id },
    name: '隔离未调用测试配置',
    provider: 'openai',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    apiKey: 'isolated-http-fixture-key',
    enabled: false,
  });
  assert.equal(record.status, 200);
  connection = await record.json();
  assert.equal(connection.hasKey, true);
  assert.equal(connection.enabled, false);
  assert.ok(!JSON.stringify(connection).includes('isolated-http-fixture-key'));
  const list = await api('/liekan/ai/connections?spaceKind=personal&spaceId=' + session.user.id);
  assert.equal(list.status, 200);
  const item = (await list.json()).items.find((item: any) => item.id === connection.id);
  assert.equal(item.lastCall, null);
  assert.equal(item.testState, 'untested');
  const removed = await api('/liekan/ai/conversations/' + conversation.id, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal((await api('/liekan/ai/runs/' + runId)).status, 404);
  console.log(
    'HTTP integration passed: session/cache/catalog, real local SSE commit, idempotent recovery, evidence/history deletion and encrypted configuration; zero provider calls.',
  );
} finally {
  if (connection)
    await api('/liekan/ai/connections/' + connection.id, 'DELETE', {
      rowVersion: connection.rowVersion,
    });
  if (websiteId) await api('/websites/' + websiteId, 'DELETE');
  await aiTransaction(tx => tx.execute('DELETE FROM \"user\" WHERE user_id=$1::uuid', fixtureId));
  await disconnectAiFactsClient();
  await prisma.client.$disconnect();
}
