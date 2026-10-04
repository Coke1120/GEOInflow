// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'dotenv/config';
import prisma from '@/lib/prisma';
import { prepareAiPrompt } from '../ai/prompt';
import { aiTransaction } from './ai-db';
import { buildAiFactsContext } from './ai-facts';

// This public integration seam intentionally requires the named isolated acceptance database.
const enabled = process.env.LIEKAN_AI_FACTS_TEST === '1';
describe.skipIf(!enabled)('authorized AI facts snapshot (isolated test demo)', () => {
  const ids = {
    user: 'd4000000-0000-4000-8000-000000000001',
    website: 'd4000000-0000-4000-8000-000000000002',
    conversation: 'd4000000-0000-4000-8000-000000000003',
    epoch: 'd4000000-0000-4000-8000-000000000004',
    import: 'd4000000-0000-4000-8000-000000000005',
  };
  let db: any;
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('The named isolated acceptance database is required');
    const target = new URL(databaseUrl);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15439' ||
      target.pathname !== '/liekan_ai_acceptance'
    )
      throw new Error('Only the named isolated acceptance database is permitted');
    db = {
      query: (sql: string, params: unknown[] = []) => aiTransaction(tx => tx.query(sql, ...params)),
      end: () => prisma.client.$disconnect(),
    };
    await db.query('INSERT INTO "user"(user_id,username,password,role) VALUES($1,$2,$3,$4)', [
      ids.user,
      'test-demo-ai-facts',
      'test-demo-no-login',
      'user',
    ]);
    await db.query('INSERT INTO website(website_id,name,domain,user_id) VALUES($1,$2,$3,$4)', [
      ids.website,
      'test-demo-ai-facts',
      'example.com',
      ids.user,
    ]);
    await db.query(
      'INSERT INTO liekan_ai_website_state(website_id,epoch,owner_user_id) VALUES($1,$2,$3)',
      [ids.website, ids.epoch, ids.user],
    );
    await db.query(
      'INSERT INTO liekan_ai_conversation(id,creator_id,owner_user_id,website_id,website_epoch) VALUES($1,$2,$2,$3,$4)',
      [ids.conversation, ids.user, ids.website, ids.epoch],
    );
    await db.query(
      'INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES($1,$2,$3,3,0)',
      [ids.import, ids.website, 'test-demo-ai-facts'],
    );
    await db.query(
      `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification) VALUES
    ('test-demo-current',$1,$2,'2026-10-02T10:00:00Z','/users/alice%2540example.com?api_key=canaryKey','GET',403,0,'canaryIP','canaryHash','canaryUA','canaryLocation','GPTBot','OpenAI','训练','unverified'),
    ('test-demo-previous',$1,$2,'2026-09-29T10:00:00Z','/article/2026','GET',200,0,'canaryIP','canaryHash','canaryUA','canaryLocation','GPTBot','OpenAI','训练','unverified')`,
      [ids.website, ids.import],
    );
  });
  afterAll(async () => {
    if (db) {
      for (const table of ['website_event', 'session', 'report'])
        await db.query(`DELETE FROM ${table} WHERE website_id=$1`, [ids.website]);
      await db.query('DELETE FROM website WHERE website_id=$1', [ids.website]);
      await db.query('DELETE FROM "user" WHERE user_id=$1', [ids.user]);
      await db.end();
    }
  });
  const input = {
    clientRequestId: 'd4000000-0000-4000-8000-000000000010',
    expectedConfigVersion: 1,
    question: '测试演示事实',
    startAt: '2026-10-01T00:00:00.000Z',
    endAt: '2026-10-03T23:59:59.999Z',
    timezone: 'UTC',
  };
  it('returns real current/previous log counts and sanitized explicit fact DTOs', async () => {
    const context = await buildAiFactsContext({
      actor: { id: ids.user, role: 'user' },
      conversationId: ids.conversation,
      input,
      signal: new AbortController().signal,
    });
    const summary = context.facts.find(f => f.id === 'summary');
    expect(summary?.data).toMatchObject({
      logs: { requests: 1, aiRequests: 1, errors403: 1 },
      previousLogs: { requests: 1, aiRequests: 1 },
    });
    expect(context.facts.find(f => f.id === 'log-errors')?.data).toMatchObject({
      current: { requests: 1, errors403: 1, errors404: 0, errors5xx: 0 },
      previous: { requests: 0, errors403: 0, errors404: 0, errors5xx: 0 },
      previousRequests: 0,
      changePercent: null,
    });
    expect(context.sourceStates.human).toBe('not_connected');
    expect(summary?.data).toMatchObject({ current: null, previous: null });
    expect(context.sourceStates.logs).toBe('available');
    for (const canary of [
      'canaryKey',
      'canaryIP',
      'canaryHash',
      'canaryUA',
      'canaryLocation',
      'alice',
      'example.com?',
    ])
      expect(JSON.stringify(context)).not.toContain(canary);
  });
  it('rejects invalid ranges and another actor through the public preparation seam', async () => {
    await expect(
      buildAiFactsContext({
        actor: { id: ids.user, role: 'user' },
        conversationId: ids.conversation,
        input: { ...input, filters: { ip: 'canaryIP' } } as any,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      buildAiFactsContext({
        actor: { id: 'd4000000-0000-4000-8000-000000000099', role: 'admin' },
        conversationId: ids.conversation,
        input,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('uses actual first-page AI channel attribution and configured goal event/visit semantics', async () => {
    const uid = (n: number) => `d4000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    for (let n = 101; n <= 104; n++)
      await db.query('INSERT INTO session(session_id,website_id) VALUES($1,$2)', [
        uid(n),
        ids.website,
      ]);
    const events = [
      {
        id: uid(201),
        session: uid(101),
        visit: uid(301),
        at: '2026-10-02T10:00:00Z',
        path: '/article',
        type: 1,
        source: 'chatgpt',
        medium: '',
        referrer: 'canary-referrer.example',
        event: null,
      },
      {
        id: uid(202),
        session: uid(101),
        visit: uid(301),
        at: '2026-10-02T10:01:00Z',
        path: '/thanks',
        type: 1,
        source: '',
        medium: '',
        referrer: '',
        event: null,
      },
      {
        id: uid(203),
        session: uid(101),
        visit: uid(301),
        at: '2026-10-02T10:02:00Z',
        path: '/thanks',
        type: 1,
        source: '',
        medium: '',
        referrer: '',
        event: null,
      },
      {
        id: uid(204),
        session: uid(101),
        visit: uid(301),
        at: '2026-10-02T10:03:00Z',
        path: '/thanks',
        type: 2,
        source: '',
        medium: '',
        referrer: '',
        event: 'signup',
      },
      {
        id: uid(205),
        session: uid(101),
        visit: uid(301),
        at: '2026-10-02T10:04:00Z',
        path: '/thanks',
        type: 2,
        source: '',
        medium: '',
        referrer: '',
        event: 'signup',
      },
      {
        id: uid(206),
        session: uid(102),
        visit: uid(302),
        at: '2026-10-02T11:00:00Z',
        path: '/home',
        type: 1,
        source: 'chatgpt',
        medium: 'email',
        referrer: '',
        event: null,
      },
      {
        id: uid(207),
        session: uid(103),
        visit: uid(303),
        at: '2026-09-29T11:00:00Z',
        path: '/home',
        type: 1,
        source: '',
        medium: '',
        referrer: 'perplexity.ai',
        event: null,
      },
      {
        id: uid(208),
        session: uid(103),
        visit: uid(303),
        at: '2026-09-29T11:01:00Z',
        path: '/home',
        type: 2,
        source: '',
        medium: '',
        referrer: '',
        event: 'signup',
      },
      {
        id: uid(209),
        session: uid(104),
        visit: uid(304),
        at: '2026-10-02T12:00:00Z',
        path: '/custom-only',
        type: 2,
        source: '',
        medium: '',
        referrer: '',
        event: 'signup',
      },
    ];
    for (const e of events)
      await db.query(
        'INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,utm_source,utm_medium,utm_campaign,referrer_domain,event_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          e.id,
          ids.website,
          e.session,
          e.visit,
          e.at,
          e.path,
          e.type,
          e.source,
          e.medium,
          'canary-utm-campaign',
          e.referrer,
          e.event,
        ],
      );
    for (const [n, name, parameters] of [
      [401, 'test-demo-path', { type: 'path', value: '/thanks' }],
      [402, 'test-demo-event alice@example.com', { type: 'event', value: 'signup' }],
      [403, 'test-demo-invalid', { type: 'path' }],
    ] as const)
      await db.query(
        'INSERT INTO report(report_id,user_id,website_id,type,name,description,parameters) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [uid(n), ids.user, ids.website, 'goal', name, 'test-demo', JSON.stringify(parameters)],
      );
    const context = await buildAiFactsContext({
      actor: { id: ids.user, role: 'user' },
      conversationId: ids.conversation,
      input,
      signal: new AbortController().signal,
    });
    expect(context.facts.find(f => f.id === 'summary')?.data).toMatchObject({
      current: { pageviews: 4, visitors: 2, visits: 2 },
      previous: { pageviews: 1, visitors: 1, visits: 1 },
      changePercent: { pageviews: 300, visitors: 100, visits: 100 },
    });
    expect(context.facts.find(f => f.id === 'ai-referrals')?.data).toMatchObject({
      visits: 1,
      pageviews: 3,
      previousVisits: 1,
      previousPageviews: 1,
    });
    const pages = context.facts.find(f => f.id === 'pages');
    expect(pages?.data).toMatchObject({ total: 5, omitted: 0, truncated: false });
    if (pages?.id === 'pages') {
      expect(pages.data.rows.find(row => row.path === '/home')).toMatchObject({
        humanPageviews: 1,
        previousHumanPageviews: 1,
        aiRequests: 0,
        previousAiRequests: 0,
      });
      expect(pages.data.rows.find(row => row.path === '/article/2026')).toMatchObject({
        humanPageviews: 0,
        previousHumanPageviews: 0,
        aiRequests: 0,
        previousAiRequests: 1,
      });
      expect(pages.data.rows.find(row => row.path === '/thanks')).toMatchObject({
        humanPageviews: 2,
        previousHumanPageviews: 0,
        aiRequests: 0,
        previousAiRequests: 0,
      });
    }
    const prepared = prepareAiPrompt({
      context,
      question: '核对当前统计',
      history: [],
      connectionConfig: {
        provider: 'custom',
        protocol: 'openai-chat',
        baseUrl: 'https://models.example.com/v1',
        model: 'test-demo',
      },
    });
    expect(prepared.contextSent.metrics).toEqual(context.metrics);
    expect(prepared.contextSent.facts).toHaveLength(6);
    expect(prepared.inputBytes + 2048).toBeLessThanOrEqual(Math.floor(16384 * 0.9));
    const goals = context.facts.find(f => f.id === 'goals');
    expect(goals?.data).toMatchObject({ configured: 3, invalidDefinitions: 1, total: 2 });
    if (goals?.id === 'goals') {
      expect(goals.data.rows.find(r => r.type === 'path')).toMatchObject({
        count: 2,
        convertedVisits: 1,
        ratePercent: 50,
        previousCount: 0,
        changePercent: null,
      });
      expect(goals.data.rows.find(r => r.type === 'event')).toMatchObject({
        count: 3,
        convertedVisits: 1,
        ratePercent: 50,
        previousCount: 1,
        previousConvertedVisits: 1,
        previousRatePercent: 100,
      });
    }
    expect(JSON.stringify(context)).not.toMatch(
      /canary-utm|canary-referrer|alice@example.com|signup/,
    );
    for (const table of ['website_event', 'session', 'report'])
      await db.query(`DELETE FROM ${table} WHERE website_id=$1`, [ids.website]);
    const periodEmpty = await buildAiFactsContext({
      actor: { id: ids.user, role: 'user' },
      conversationId: ids.conversation,
      input: { ...input, startAt: '2026-08-01T00:00:00.000Z', endAt: '2026-08-01T23:59:59.999Z' },
      signal: new AbortController().signal,
    });
    expect(periodEmpty.sourceStates.logs).toBe('empty');
    expect(periodEmpty.facts.find(f => f.id === 'log-errors')?.data).toMatchObject({
      current: { requests: 0, errors403: 0, errors404: 0, errors5xx: 0 },
      previous: { requests: 0, errors403: 0, errors404: 0, errors5xx: 0 },
    });
    expect(periodEmpty.facts.find(f => f.id === 'summary')?.data).toMatchObject({
      logs: { requests: 0 },
    });
  });
  it('keeps unsupported storage as null local guidance facts without a provider request', async () => {
    process.env.CLICKHOUSE_URL = 'http://test-demo-clickhouse.invalid';
    try {
      const context = await buildAiFactsContext({
        actor: { id: ids.user, role: 'user' },
        conversationId: ids.conversation,
        input,
        signal: new AbortController().signal,
      });
      expect(context.facts).toEqual([]);
      expect(context.sourceStates.human).toBe('unsupported');
      expect(context.metrics.every(m => m.value === null && m.state === 'unsupported')).toBe(true);
    } finally {
      delete process.env.CLICKHOUSE_URL;
    }
  });

  it('preserves complete summary totals and bounded mixed-class bot aggregates across both periods', async () => {
    const insert = async (
      id: string,
      name: string,
      type: string,
      at: string,
      status: number,
      path: string,
    ) =>
      db.query(
        `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification) VALUES($1,$2,$3,$4,$5,'GET',$6,0,'','','','',$7,'test-demo',$8,'test-demo-unknown')`,
        [id, ids.website, ids.import, at, path, status, name, type],
      );
    for (let n = 1; n <= 25; n++)
      await insert(
        `test-demo-bin-current-${n}`,
        `test-demo-bot-${n}`,
        '搜索',
        '2026-10-02T14:00:00Z',
        n === 1 ? 403 : n === 2 ? 404 : n === 3 ? 503 : 200,
        `/test-demo-bin/${n}`,
      );
    await insert(
      'test-demo-bin-current-other',
      'test-demo-Google',
      '传统搜索',
      '2026-10-02T14:00:00Z',
      200,
      '/test-demo-bin/other',
    );
    await insert(
      'test-demo-bin-previous-25a',
      'test-demo-bot-25',
      '搜索',
      '2026-09-29T14:00:00Z',
      404,
      '/test-demo-bin/25',
    );
    await insert(
      'test-demo-bin-previous-25b',
      'test-demo-bot-25',
      '搜索',
      '2026-09-29T14:01:00Z',
      503,
      '/test-demo-bin/25',
    );
    await insert(
      'test-demo-bin-previous-only',
      'test-demo-prior-only',
      '用户触发',
      '2026-09-29T14:00:00Z',
      403,
      '/test-demo-bin/prior-only',
    );
    await insert(
      'test-demo-bin-previous-other',
      'test-demo-Google',
      '传统搜索',
      '2026-09-29T14:00:00Z',
      404,
      '/test-demo-bin/other',
    );
    const context = await buildAiFactsContext({
      actor: { id: ids.user, role: 'user' },
      conversationId: ids.conversation,
      input,
      signal: new AbortController().signal,
    });
    expect(context.facts.find(f => f.id === 'summary')?.data).toMatchObject({
      logs: { requests: 27, aiRequests: 26, errors403: 2, errors404: 1, errors5xx: 1 },
      previousLogs: { requests: 5, aiRequests: 4, errors403: 1, errors404: 2, errors5xx: 1 },
    });
    const bots = context.facts.find(f => f.id === 'bots');
    expect(bots?.data).toMatchObject({
      total: 27,
      omitted: 7,
      truncated: true,
      requests: 26,
      previousRequests: 4,
    });
    if (bots?.id === 'bots') {
      expect(bots.data.rows).toHaveLength(20);
      expect(bots.data.rows.find(row => row.name === 'test-demo-bot-25')).toMatchObject({
        requests: 1,
        previousRequests: 2,
        changePercent: -50,
        verification: 'unverified',
      });
      expect(bots.data.rows.some(row => row.name === 'test-demo-Google')).toBe(false);
    }
    expect(context.facts.find(f => f.id === 'log-errors')?.data).toMatchObject({
      current: { requests: 4, errors403: 2, errors404: 1, errors5xx: 1 },
      previous: { requests: 4, errors403: 1, errors404: 2, errors5xx: 1 },
      changePercent: 0,
    });
    const pages = context.facts.find(f => f.id === 'pages');
    expect(pages?.data).toMatchObject({ total: 28, omitted: 8, truncated: true });
    if (pages?.id === 'pages') {
      expect(pages.data.rows).toHaveLength(20);
      expect(pages.data.rows.find(row => row.path === '/test-demo-bin/25')).toMatchObject({
        humanPageviews: null,
        previousHumanPageviews: null,
        aiRequests: 1,
        previousAiRequests: 2,
      });
    }
    await db.query("DELETE FROM liekan_log WHERE website_id=$1 AND id LIKE 'test-demo-bin-%'", [
      ids.website,
    ]);
  });

  it('retains catalog registration and distinguishes missing log input from measured zero', async () => {
    await db.query('DELETE FROM liekan_import WHERE id=$1', [ids.import]);
    await db.query(
      'INSERT INTO liekan_catalog(website_id,path,title,content_type) VALUES($1,$2,$3,$4)',
      [ids.website, '/test-demo-catalog', 'api_key=canaryKey', 'test-demo'],
    );
    const context = await buildAiFactsContext({
      actor: { id: ids.user, role: 'user' },
      conversationId: ids.conversation,
      input,
      signal: new AbortController().signal,
    });
    expect(context.sourceStates.catalog).toBe('available');
    expect(context.sourceStates.logs).toBe('not_connected');
    expect(context.facts.find(f => f.id === 'summary')?.data).toMatchObject({
      logs: null,
      previousLogs: null,
    });
    expect(context.metrics.find(m => m.key === 'aiRequests')?.value).toBeNull();
    expect(context.facts.find(f => f.id === 'log-errors')?.data).toMatchObject({
      current: null,
      previous: null,
      previousRequests: null,
      changePercent: null,
    });
    expect(JSON.stringify(context)).not.toContain('canaryKey');
  });
  it('includes the shared read-queue wait in its five-second facts deadline',async()=>{
    let ready:()=>void,release:()=>void;
    const readyPromise=new Promise<void>(resolve=>{ready=resolve;}),releasePromise=new Promise<void>(resolve=>{release=resolve;});
    const blocker=aiTransaction(async tx=>{await tx.query('SELECT true AS acquired FROM pg_advisory_xact_lock(12800073)');ready();await releasePromise;},{timeout:12000});
    await readyPromise;
    try{await expect(buildAiFactsContext({actor:{id:ids.user,role:'user'},conversationId:ids.conversation,input,signal:new AbortController().signal})).rejects.toMatchObject({code:'facts_timeout'});}
    finally{release();await blocker;}
  },10000);

});
