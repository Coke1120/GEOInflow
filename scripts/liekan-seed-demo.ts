import 'dotenv/config';
import { v5 } from 'uuid';
import { BOT_RULES } from '../src/lib/liekan/rules/bots';
import { importCatalog, importLogs } from '../src/lib/liekan/store';
import { query, transaction } from '../src/lib/liekan/upstream/server';

const id = '5b4c0de0-6c47-5b51-8f53-11e5e8c79001';
const uid = (name: string) => v5(name, id);
const anchor = new Date();
anchor.setUTCHours(0, 0, 0, 0);
const paths = ['/', '/docs/geo', '/cases/saas', '/articles/ai-search', '/contact'];
const user = (
  await query(
    'SELECT user_id AS id FROM "user" WHERE role=\'admin\' AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
  )
)[0];
if (!user) throw new Error('Seed requires an existing administrator; credentials are never reset');
await transaction(async tx => {
  await tx.$executeRawUnsafe(
    'INSERT INTO website(website_id,name,domain,user_id,created_by,created_at,updated_at) VALUES($1::uuid,$2,$3,$4::uuid,$4::uuid,now(),now()) ON CONFLICT(website_id) DO NOTHING',
    id,
    'Liekan 演示站（示例数据）',
    'demo.liekan.example',
    user.id,
  );
  await tx.$executeRawUnsafe(
    'INSERT INTO liekan_setting(website_id,is_demo,rules) VALUES($1::uuid,true,$2::jsonb) ON CONFLICT(website_id) DO UPDATE SET is_demo=true',
    id,
    JSON.stringify(BOT_RULES),
  );
  for (let day = 0; day < 10; day++)
    for (let visitor = 0; visitor < 30; visitor++) {
      const session = uid(`session:${anchor.toISOString()}:${day}:${visitor}`),
        visit = uid(`visit:${anchor.toISOString()}:${day}:${visitor}`);
      const time = new Date(anchor.getTime() - day * 86400000 + visitor * 60000);
      await tx.$executeRawUnsafe(
        `INSERT INTO session(session_id,website_id,browser,os,device,country,region,city,created_at) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        session,
        id,
        visitor % 2 ? 'chrome' : 'safari',
        visitor % 2 ? 'Windows 11' : 'iOS 18',
        visitor % 2 ? 'desktop' : 'mobile',
        visitor % 3 ? 'CN' : 'US',
        visitor % 3 ? 'CN-31' : 'US-CA',
        visitor % 3 ? '上海' : 'San Francisco',
        time,
      );
      for (let step = 0; step < 3; step++)
        await tx.$executeRawUnsafe(
          `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,hostname,referrer_domain) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,1,$7,$8) ON CONFLICT DO NOTHING`,
          uid(`event:${visit}:${step}`),
          id,
          session,
          visit,
          new Date(time.getTime() + step * 120000),
          paths[step === 2 ? 4 : (visitor + step) % 4],
          'demo.liekan.example',
          visitor % 3 === 0 ? 'chatgpt.com' : visitor % 3 === 1 ? 'www.google.com' : '',
        );
      if (visitor % 3 === 0)
        await tx.$executeRawUnsafe(
          `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,event_name,hostname) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,2,$7,$8) ON CONFLICT DO NOTHING`,
          uid(`goal:${visit}`),
          id,
          session,
          visit,
          new Date(time.getTime() + 300000),
          '/contact',
          'download_whitepaper',
          'demo.liekan.example',
        );
    }
  const definitions = [
    {
      name: '白皮书下载',
      type: 'goal',
      parameters: { type: 'event', value: 'download_whitepaper' },
    },
    {
      name: '资料获取路径',
      type: 'funnel',
      parameters: {
        window: 24,
        steps: [
          { type: 'path', value: '/' },
          { type: 'path', value: '/contact' },
          { type: 'event', value: 'download_whitepaper' },
        ],
      },
    },
  ];
  for (const d of definitions)
    await tx.$executeRawUnsafe(
      'INSERT INTO report(report_id,user_id,website_id,name,type,description,parameters,created_at,updated_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb,now(),now()) ON CONFLICT DO NOTHING',
      uid(d.name),
      user.id,
      id,
      d.name,
      d.type,
      '明确标识的演示数据',
      JSON.stringify(d.parameters),
    );
});
const catalog = [...paths, '/uncrawled/guide', '/uncrawled/pricing'].map((path, index) => ({
  url: `https://demo.liekan.example${path}`,
  title: `演示内容 ${index + 1}`,
  type: path.includes('cases')
    ? '案例'
    : path.includes('articles')
      ? '图文'
      : path.includes('contact')
        ? '交互页'
        : '文档',
  wordCount: 400 + index * 260,
  structureScore: 50 + index * 7,
  publishedAt: new Date(anchor.getTime() - 9 * 86400000).toISOString(),
}));
await importCatalog(id, 'demo.liekan.example', {
  format: 'json',
  content: JSON.stringify(catalog),
});
const records = Array.from({ length: 1200 }, (_, i) => ({
  time: new Date(
    anchor.getTime() - Math.floor(i / 120) * 86400000 + (i % 120) * 30000,
  ).toISOString(),
  ip: `203.0.113.${(i % 200) + 1}`,
  method: 'GET',
  path: paths[i % 5],
  status: i % 25 === 0 ? 404 : 200,
  bytes: 4096,
  userAgent: `Mozilla/5.0 ${BOT_RULES[i % BOT_RULES.length].pattern}/1.0`,
  location: '演示位置',
}));
const imported = [];
for (let index = 0; index < records.length; index += 1000)
  imported.push(
    await importLogs(id, 'demo.liekan.example', {
      format: 'json',
      records: records.slice(index, index + 1000),
    }),
  );
console.log(
  JSON.stringify({
    websiteId: id,
    demo: true,
    visitors: 300,
    pageviews: 900,
    convertedVisits: 100,
    logs: imported.reduce((sum, result) => sum + result.inserted, 0),
  }),
);
process.exit(0);
