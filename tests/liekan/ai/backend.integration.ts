import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../../../src/lib/prisma';
import { aiTransaction } from '../../../src/lib/liekan/upstream/ai-db';
import {
  createAiConnection,
  listAiConnections,
  updateAiConnection,
  deleteAiConnection,
} from '../../../src/lib/liekan/ai/connections';
import {
  acceptAiRun,
  getAiRun,
  cancelAiRun,
  failAiRun,
  setAiRunStage,
  completeAiRun,
} from '../../../src/lib/liekan/ai/runs';
import {
  createAiConversation,
  getAiConversation,
  deleteAiConversation,
  getAiContext,
} from '../../../src/lib/liekan/ai/conversations';
import { clearAiWebsiteInTransaction } from '../../../src/lib/liekan/upstream/ai-lifecycle';
import { getRawQueryClient } from '../../../src/lib/prisma';
import { saveAiContext } from '../../../src/lib/liekan/ai/runs';
import { cleanupAiData } from '../../../src/lib/liekan/ai/maintenance';
import { buildAiFactsContext } from '../../../src/lib/liekan/upstream/ai-facts';
const db = new URL(process.env.DATABASE_URL!);
assert.equal(db.hostname, '127.0.0.1');
assert.equal(db.port, '15439');
assert.equal(db.pathname, '/liekan_ai_acceptance');
const ids = Array.from({ length: 4 }, () => randomUUID()),
  siteId = randomUUID();
const actor = { id: ids[0], role: 'user' },
  other = { id: ids[1], role: 'user' };
try {
  await aiTransaction(async tx => {
    for (const id of ids)
      await tx.execute(
        'INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,$3,\'user\')',
        id,
        `ai-acceptance-${id.slice(0, 8)}`,
        'isolated fixture login disabled',
      );
    await tx.execute(
      'INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid)',
      siteId,
      'AI acceptance fixture',
      'ai-acceptance.example',
      actor.id,
    );
  });
  const space = { kind: 'personal' as const, id: actor.id };
  const input = {
    name: 'Acceptance fixture API',
    provider: 'openai',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    space,
    apiKey: 'isolated-fixture-key',
  };
  const connection = await createAiConnection(actor, input);
  assert.equal(connection.testState, 'untested');
  assert.equal(connection.hasKey, true);
  assert.ok(!JSON.stringify(connection).includes(input.apiKey));
  await assert.rejects(() => listAiConnections(other, space), { status: 404 });
  const { space: _, apiKey: __, ...edit } = input;
  await assert.rejects(
    () =>
      updateAiConnection(actor, connection.id, {
        ...edit,
        rowVersion: connection.rowVersion,
        isDefault: true,
      }),
    { code: 'test_required' },
  );
  const runInput = {
    operation: 'test' as const,
    targetId: connection.id,
    clientRequestId: randomUUID(),
    expectedConfigVersion: connection.configVersion,
  };
  const [first, duplicate] = await Promise.all([
    acceptAiRun(actor, runInput),
    acceptAiRun(actor, runInput),
  ]);
  assert.equal(first.row.id, duplicate.row.id);
  assert.equal(Number(first.fresh) + Number(duplicate.fresh), 1);
  const handle = first.fresh ? first : duplicate;
  await assert.rejects(() => acceptAiRun(actor, { ...runInput, expectedConfigVersion: 99 }), {
    status: 409,
  });
  await assert.rejects(() => acceptAiRun(actor, { ...runInput, clientRequestId: randomUUID() }), {
    status: 429,
  });
  await assert.rejects(() => getAiRun(other, handle.row.id), { status: 404 });
  await cancelAiRun(actor, handle.row.id);
  await failAiRun(handle, 'cancelled', 'cancelled');
  assert.equal((await getAiRun(actor, handle.row.id)).state, 'cancelled');
  await assert.rejects(
    () => completeAiRun(actor, handle, { text: 'late' }, { ttftMs: null, usage: null }),
    { status: 409 },
  );
  const failedTest = await acceptAiRun(actor, { ...runInput, clientRequestId: randomUUID() });
  await failAiRun(failedTest, 'network', 'failed', {
    status: 503,
    requestId: 'req-isolated-failed',
  });
  const failedDto = await getAiRun(actor, failedTest.row.id);
  assert.equal(failedDto.state, 'failed');
  assert.deepEqual(failedDto.result, {
    providerResponse: { status: 503, requestId: 'req-isolated-failed' },
  });
  await aiTransaction(tx =>
    tx.execute(
      "UPDATE liekan_ai_run SET result_expires_at=now()-interval '1 second' WHERE id=$1::uuid",
      failedTest.row.id,
    ),
  );
  assert.equal(
    (await getAiRun(actor, failedTest.row.id)).result,
    undefined,
    'Failed response metadata expires with the result retention',
  );
  const second = await acceptAiRun(actor, { ...runInput, clientRequestId: randomUUID() });
  await setAiRunStage(actor, second, 'preparing');
  await setAiRunStage(actor, second, 'calling');
  await assert.rejects(() => setAiRunStage(actor, second, 'preparing'), { status: 409 });
  await completeAiRun(
    actor,
    second,
    { text: 'LIEKAN_OK fixture', origin: 'provider' },
    { ttftMs: 10, usage: null, stream: true },
  );
  const after = (await listAiConnections(actor, space)).items[0];
  assert.equal(after.testState, 'connected');
  const selected = await updateAiConnection(actor, connection.id, {
    ...edit,
    rowVersion: after.rowVersion,
    isDefault: true,
  });
  assert.equal(selected.isDefault, true);
  const localChoice = await createAiConversation(actor, { websiteId: siteId });
  const localChoiceInput = {
    operation: 'analysis' as const,
    targetId: localChoice.id,
    clientRequestId: randomUUID(),
    expectedConfigVersion: 1,
    localOnly: true,
    question: '本地接入指引',
    startAt: new Date(Date.now() - 86400000).toISOString(),
    endAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
  };
  const localChoiceRun = await acceptAiRun(actor, localChoiceInput);
  assert.equal(
    localChoiceRun.connection,
    null,
    'Explicit local-only analysis must never resolve an available default connection',
  );
  assert.equal(localChoiceRun.row.connection_id, null);
  assert.equal((await acceptAiRun(actor, localChoiceInput)).fresh, false);
  await assert.rejects(
    () => acceptAiRun(actor, { ...localChoiceInput, connectionId: connection.id }),
    { code: 'invalid_request' },
  );
  await failAiRun(localChoiceRun, 'cancelled', 'cancelled');
  await deleteAiConversation(actor, localChoice.id);

  const changed = await updateAiConnection(actor, connection.id, {
    ...edit,
    rowVersion: selected.rowVersion,
    apiKey: 'replacement-isolated-fixture',
  });
  assert.equal(changed.isDefault, false);
  assert.equal(changed.testState, 'untested');
  await assert.rejects(
    () => updateAiConnection(actor, connection.id, { ...edit, rowVersion: selected.rowVersion }),
    { status: 409 },
  );
  const conv = await createAiConversation(actor, { websiteId: siteId });
  await assert.rejects(() => getAiConversation(other, conv.id), { status: 404 });
  await deleteAiConversation(actor, conv.id);
  await assert.rejects(() => getAiConversation(actor, conv.id), { status: 404 });
  await deleteAiConnection(actor, connection.id, changed.rowVersion);
  assert.equal(
    ((await getAiRun(actor, second.row.id)).result as { text: string })?.text,
    'LIEKAN_OK fixture',
  );
  const quotaConnections = [];
  for (const id of ids) {
    const person = { id, role: 'user' };
    quotaConnections.push(
      await createAiConnection(person, { ...input, space: { kind: 'personal', id } }),
    );
  }
  const active = [];
  for (let i = 0; i < 3; i++)
    active.push(
      await acceptAiRun(
        { id: ids[i], role: 'user' },
        {
          operation: 'test',
          targetId: quotaConnections[i].id,
          clientRequestId: randomUUID(),
          expectedConfigVersion: 1,
        },
      ),
    );
  await assert.rejects(
    () =>
      acceptAiRun(
        { id: ids[3], role: 'user' },
        {
          operation: 'test',
          targetId: quotaConnections[3].id,
          clientRequestId: randomUUID(),
          expectedConfigVersion: 1,
        },
      ),
    { code: 'busy', status: 429 },
  );
  for (const run of active) await failAiRun(run, 'cancelled', 'cancelled');
  const frequencyActor = { id: ids[3], role: 'user' };
  await aiTransaction(tx =>
    tx.execute(
      "INSERT INTO liekan_ai_run(id,creator_id,identity_id,owner_user_id,client_request_id,request_hash,operation,connection_snapshot,config_version,state,created_at) SELECT gen_random_uuid(),$1::uuid,$1::uuid,$1::uuid,gen_random_uuid(),repeat('a',64),'test','{}'::jsonb,1,'failed',now()-interval '10 seconds' FROM generate_series(1,10)",
      frequencyActor.id,
    ),
  );
  await assert.rejects(
    () =>
      acceptAiRun(frequencyActor, {
        operation: 'test',
        targetId: quotaConnections[3].id,
        clientRequestId: randomUUID(),
        expectedConfigVersion: 1,
      }),
    { code: 'frequency_limit' },
  );
  await aiTransaction(tx =>
    tx.execute(
      "UPDATE liekan_ai_run SET created_at=now()-interval '5 minutes' WHERE identity_id=$1::uuid",
      frequencyActor.id,
    ),
  );
  await aiTransaction(tx =>
    tx.execute(
      "INSERT INTO liekan_ai_run(id,creator_id,identity_id,owner_user_id,client_request_id,request_hash,operation,connection_snapshot,config_version,state,created_at) SELECT gen_random_uuid(),$1::uuid,$1::uuid,$1::uuid,gen_random_uuid(),repeat('a',64),'test','{}'::jsonb,1,'failed',now()-interval '5 minutes' FROM generate_series(1,90)",
      frequencyActor.id,
    ),
  );
  await assert.rejects(
    () =>
      acceptAiRun(frequencyActor, {
        operation: 'test',
        targetId: quotaConnections[3].id,
        clientRequestId: randomUUID(),
        expectedConfigVersion: 1,
      }),
    { code: 'daily_limit' },
  );
  const expired = await acceptAiRun(other, {
    operation: 'test',
    targetId: quotaConnections[1].id,
    clientRequestId: randomUUID(),
    expectedConfigVersion: 1,
  });
  await aiTransaction(tx =>
    tx.execute(
      "UPDATE liekan_ai_run SET lease_until=now()-interval '1 second' WHERE id=$1::uuid",
      expired.row.id,
    ),
  );
  await failAiRun(expired, 'network');
  assert.equal((await getAiRun(other, expired.row.id)).state, 'interrupted');
  const localConversation = await createAiConversation(actor, { websiteId: siteId });
  const localInput = {
    operation: 'analysis' as const,
    targetId: localConversation.id,
    clientRequestId: randomUUID(),
    expectedConfigVersion: 1,
    question: '查看真实数据',
    startAt: new Date(Date.now() - 86400000).toISOString(),
    endAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
  };
  const local = await acceptAiRun(actor, localInput);
  await setAiRunStage(actor, local, 'preparing');
  const context = await buildAiFactsContext({
    actor,
    conversationId: localConversation.id,
    input: {
      clientRequestId: localInput.clientRequestId,
      expectedConfigVersion: 1,
      question: localInput.question,
      startAt: localInput.startAt,
      endAt: localInput.endAt,
      timezone: localInput.timezone,
    },
    signal: new AbortController().signal,
  });
  await saveAiContext(actor, local, context);
  await completeAiRun(
    actor,
    local,
    { summary: '本地指引', observations: [], possibleCauses: [], suggestions: [], limitations: [] },
    { ttftMs: null, usage: null, local: true },
  );
  const [released] = await aiTransaction(tx =>
    tx.query(
      'SELECT call_attempted,daily_reserved FROM liekan_ai_run WHERE id=$1::uuid',
      local.row.id,
    ),
  );
  assert.equal(released.call_attempted, false);
  assert.equal(released.daily_reserved, false);
  assert.equal((await getAiContext(actor, localConversation.id, context.id)).id, context.id);
  const primary: any = getRawQueryClient(prisma.client, { write: true });
  await primary.$transaction(async (tx: any) => clearAiWebsiteInTransaction(tx, siteId));
  await assert.rejects(() => getAiConversation(actor, localConversation.id), { status: 404 });
  await assert.rejects(() => getAiRun(actor, local.row.id), { status: 404 });
  const [derived] = await aiTransaction(tx =>
    tx.query('SELECT count(*) AS count FROM liekan_ai_context WHERE id=$1::uuid', context.id),
  );
  assert.equal(derived.count, 0n);
  const cleanup = await cleanupAiData({ apply: true });
  assert.equal(cleanup.installed, true);
  console.log(
    'AI integration passed: encrypted CRUD, ownership, default/version fences, concurrent idempotency, quotas, cancellation, persisted recovery, private conversations. No provider called.',
  );
} finally {
  await aiTransaction(async tx => {
    await tx.execute('DELETE FROM website WHERE website_id=$1::uuid', siteId);
    for (const id of ids) await tx.execute('DELETE FROM "user" WHERE user_id=$1::uuid', id);
  });
  await prisma.client.$disconnect();
}
