import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { columns, pages } from '../src/components/liekan/data.ts';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3002';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Use an isolated local candidate');
const tailwind = fs.readFileSync('design/reference/vendor/tailwind-3.4.17.js', 'utf8');
const echarts = fs.readFileSync('node_modules/echarts/dist/echarts.min.js', 'utf8');
const fonts = fs.readFileSync('public/liekan/fonts/inter-latin.woff2');
const credentialFile = process.env.LIEKAN_TEST_CREDENTIAL_FILE || '.local/ui-test.env';
const credentials = Object.fromEntries(
  fs
    .readFileSync(credentialFile, 'utf8')
    .split('\n')
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .map(line => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    }),
);
const browser = await chromium.launch({
  headless: true,
  ...(!process.env.CI ? { channel: 'chrome' } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
  reducedMotion: 'reduce',
});
const reference = await context.newPage(),
  actual = await context.newPage();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const out = 'test-results/liekan-visual';
fs.mkdirSync(out, { recursive: true });
const names = [
  'index',
  'ai',
  'ai-bots',
  'ai-pages',
  'ai-preference',
  'human',
  'human-geo',
  'human-source',
  'content',
  'funnel',
  'logs',
];
const results = [];
const screenshotStyle = 'nextjs-portal{display:none!important}';
async function pixelDiff(first, second, masks = []) {
  return actual.evaluate(
    async ([a, b, masks]) => {
      const load = src =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [left, right] = await Promise.all([load(a), load(b)]);
      const width = Math.max(left.width, right.width),
        height = Math.max(left.height, right.height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const paint = img => {
        ctx.fillStyle = '#F5F7FA';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        ctx.fillStyle = '#F5F7FA';
        for (const r of masks)
          ctx.fillRect(
            Math.floor(r.x) - 1,
            Math.floor(r.y) - 1,
            Math.ceil(r.width) + 2,
            Math.ceil(r.height) + 2,
          );
        return ctx.getImageData(0, 0, width, height);
      };
      const l = paint(left),
        r = paint(right);
      let changed = 0;
      for (let i = 0; i < l.data.length; i += 4) {
        const differs =
          Math.max(...[0, 1, 2].map(k => Math.abs(l.data[i + k] - r.data[i + k]))) > 16;
        if (differs) changed++;
        r.data[i] = differs ? 240 : 255;
        r.data[i + 1] = differs ? 68 : 255;
        r.data[i + 2] = differs ? 82 : 255;
      }
      ctx.putImageData(r, 0, 0);
      return {
        ratio: changed / (width * height),
        dimensions: [
          [left.width, left.height],
          [right.width, right.height],
        ],
        diff: canvas.toDataURL('image/png').split(',')[1],
      };
    },
    [
      ...[first, second].map(p => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64')),
      masks,
    ],
  );
}
const exemptions = page =>
  page.evaluate(() => {
    const definitions = [
      [
        'data-values',
        'main tbody td, #prefList, #pathList, #journeyList, #blindList, #envGrid, #robotsList, #pipeList, main pre',
      ],
      [
        'metric-value-and-evidence',
        'main>section:first-child .card>p:nth-child(2),main>section:first-child .card>p:nth-child(3)',
      ],
      [
        'identity-and-time',
        'header p,aside [class*="brandText"],aside .leading-tight>span:first-child,aside [class*="siteName"],aside [class*="avatar"]',
      ],
      [
        'truthful-captions',
        'main .card>div>p,main>section:last-child>p,main>section:last-child>[class*="leading-relaxed"],main .card [class*="space-y-2.5"]',
      ],
    ];
    const result = [];
    const seen = new Set();
    for (const [reason, selector] of definitions)
      for (const root of document.querySelectorAll(selector)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim() || seen.has(node)) continue;
          seen.add(node);
          const range = document.createRange();
          range.selectNodeContents(node);
          const clip = node.parentElement
            .closest('td,[class*="truncate"],aside')
            ?.getBoundingClientRect();
          for (const r of range.getClientRects()) {
            const x = Math.max(r.x, clip?.x ?? r.x),
              right = Math.min(r.right, clip?.right ?? r.right);
            if (right > x)
              result.push({
                reason,
                text: node.textContent.trim(),
                x,
                y: r.y + scrollY,
                width: right - x,
                height: r.height,
              });
          }
        }
      }
    // Prototype headers precede <main> in a div; their metadata is dynamic too.
    const main = document.querySelector('main');
    for (const p of main.parentElement.querySelectorAll(':scope>div:first-child p')) {
      const range = document.createRange();
      range.selectNodeContents(p);
      for (const r of range.getClientRects())
        result.push({
          reason: 'identity-and-time',
          text: p.textContent,
          x: r.x,
          y: r.y + scrollY,
          width: r.width,
          height: r.height,
        });
    }
    return result;
  });
try {
  await actual.goto(base + '/login');
  await actual.locator('[data-test="input-username"] input').fill(credentials.LIEKAN_TEST_USERNAME);
  await actual.locator('[data-test="input-password"] input').fill(credentials.LIEKAN_TEST_PASSWORD);
  await actual.locator('[data-test="button-submit"]').click();
  await actual.waitForURL(url => !url.pathname.includes('/login'));
  await context.route('https://cdn.tailwindcss.com/**', route =>
    route.fulfill({ contentType: 'application/javascript', body: tailwind }),
  );
  await context.route('https://cdn.jsdelivr.net/**', route =>
    route.fulfill({ contentType: 'application/javascript', body: echarts }),
  );
  await context.route('https://fonts.googleapis.com/**', route =>
    route.fulfill({
      contentType: 'text/css',
      body: `@font-face{font-family:Inter;src:url('${base}/__visual_font');font-style:normal;font-weight:100 900;font-display:block}`,
    }),
  );
  await context.route('**/__visual_font', route =>
    route.fulfill({ contentType: 'font/woff2', body: fonts }),
  );
  await context.addInitScript(() => {
    let n = 123456;
    Math.random = () => {
      n = (1664525 * n + 1013904223) >>> 0;
      return n / 4294967296;
    };
  });
  for (let i = 0; i < names.length; i++) {
    const name = names[i],
      path = pages[i].path;
    await context.route(`${base}/__visual_reference/${name}`, route =>
      route.fulfill({
        contentType: 'text/html',
        body: fs.readFileSync(`design/reference/geo-stats-v3/${name}.html`, 'utf8'),
      }),
    );
    await reference.goto(`${base}/__visual_reference/${name}`);
    await reference.evaluate(async () => {
      await document.fonts.ready;
    });
    await reference.waitForTimeout(800);
    const payload = await reference.evaluate(
      ({ columns }) => {
        const charts = {};
        document.querySelectorAll('main [id]').forEach(el => {
          const instance = window.echarts?.getInstanceByDom(el);
          if (!instance) return;
          const o = instance.getOption(),
            first = o.series[0];
          const cat = [...(o.xAxis || []), ...(o.yAxis || [])].find(
            axis => axis.type === 'category',
          );
          let labels = cat?.data || [];
          if (['pie', 'funnel'].includes(first?.type)) labels = first.data.map(row => row.name);
          const series = o.series.map(row => ({
            name: row.name || '',
            values: row.data.map(d => (typeof d === 'object' && !Array.isArray(d) ? d.value : d)),
          }));
          let rows;
          if (first?.type === 'scatter') {
            rows = first.data.map(d => ({
              words: d[0],
              structureScore: d[1],
              requests: d[2],
              path: d[3],
            }));
            series.length = 0;
          }
          charts[el.id] = { labels, series, rows, state: 'available' };
        });
        const cards = [...document.querySelectorAll('main>section:first-child .card')].map(el => {
          const p = el.querySelectorAll('p');
          return {
            key: p[0].textContent,
            label: p[0].textContent,
            value: p[1].textContent,
            detail: p[2]?.textContent || '',
            state: 'available',
          };
        });
        const numeric = new Set([
          'pv',
          'uv',
          'humanPv',
          'aiRequests',
          'requests',
          'dailyAverage',
          'pages',
          'bots',
          'heat',
          'repeatRate',
          'failureRate',
          'share',
          'sessions',
          'conversionRate',
          'entries',
          'bounceRate',
          'count',
          'rate',
          'trend',
          'ratio',
        ]);
        const tables = {};
        for (const [id, fields] of Object.entries(columns)) {
          tables[id] = [...document.querySelectorAll(`#${id}>tr`)].map(tr => {
            const row = Object.fromEntries(
              fields.map(([key], index) => {
                let value = tr.children[index]?.textContent.trim() || null;
                if (value && numeric.has(key)) {
                  const n = Number.parseFloat(value.replaceAll(',', ''));
                  if (Number.isFinite(n)) value = n;
                }
                if (key === 'duration' && typeof value === 'string') {
                  const m = value.match(/(?:(\d+)分)?(?:(\d+)秒)?/);
                  if (m?.[1] || m?.[2]) value = Number(m[1] || 0) * 60 + Number(m[2] || 0);
                }
                return [key, value];
              }),
            );
            if (id === 'botBody') {
              row.name = tr.children[0]?.children[0]?.textContent;
              row.vendor = tr.children[0]?.children[1]?.textContent || '';
            }
            if (id === 'logBody') {
              const match = String(row.path).match(/^(\w+)\s+(.+)$/);
              if (match) {
                row.method = match[1];
                row.path = match[2];
              }
            }
            return row;
          });
        }
        const list = (id, keys) =>
          [...document.querySelectorAll(`#${id}>div`)].map(el =>
            Object.fromEntries(
              keys.map((key, index) => [key, el.children[index]?.textContent.trim() || null]),
            ),
          );
        tables.pathList = list('pathList', ['index', 'time', 'path', 'status']);
        tables.robotsList = list('robotsList', ['bot', 'policy']);
        tables.pipeList = list('pipeList', ['name', 'detail']);
        tables.prefList = list('prefList', ['bot', 'preference']);
        tables.blindList = list('blindList', ['path', 'reason', 'suggestion']);
        tables.recoList = [];
        tables.journeyList = [...document.querySelectorAll('#journeyList>div')].map(el => {
          const detail = el.querySelector('p')?.textContent || '';
          return {
            path: el.querySelector('.flex-1')?.textContent,
            count: Number.parseFloat(detail),
            conversionRate: Number.parseFloat(detail.split('转化 ')[1]),
          };
        });
        tables.envGrid = [...document.querySelectorAll('#envGrid>div')].flatMap(el =>
          [...el.querySelectorAll(':scope>div')].map(row => ({
            category: el.querySelector('p').textContent === '浏览器' ? 'browser' : 'os',
            name: row.children[0].textContent,
            share: Number.parseFloat(row.children[1].textContent),
          })),
        );
        const insightCard = [...document.querySelectorAll('main .card')].find(
          el => el.querySelector('h2')?.textContent === 'GEO 关键发现',
        );
        const insights = insightCard
          ? [...insightCard.querySelectorAll('p')].map(el => el.textContent)
          : [...document.querySelectorAll('main>section:last-child>p')].map(el =>
              el.textContent.replace(/^GEO 洞察：/, ''),
            );
        // Fixture values exist only inside this isolated browser's intercepted API.
        return {
          contractVersion: 1,
          website: {
            id: '5b4c0de0-6c47-5b51-8f53-11e5e8c79001',
            name: '视觉验收夹具',
            domain: 'www.liekan.com',
          },
          range: { startAt: 0, endAt: 86400000, timezone: 'Asia/Shanghai' },
          states: {
            human: 'available',
            logs: 'available',
            catalog: 'available',
            goals: 'available',
          },
          cards,
          charts,
          tables,
          insights,
          meta: {
            demo: false,
            canManage: true,
            latestImportAt: '2026-10-02T00:00:00Z',
            ruleCount: 18,
            totalLogs: tables.logBody.length,
            page: 1,
            pageSize: 100,
          },
        };
      },
      { columns },
    );
    await actual.route('**/api/liekan/**/report?*', route =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }),
    );
    await actual.goto(`${base}/websites/${payload.website.id}/geo${path}`);
    await actual.locator('main').waitFor();
    await actual.evaluate(async () => {
      await document.fonts.ready;
    });
    await actual.waitForTimeout(800);
    const measure = page =>
      page.evaluate(() => ({
        cards: [...document.querySelectorAll('main .card')].map(el => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
        charts: [...document.querySelectorAll('main [id]')]
          .filter(el => /^(d[123]|a[1234]|b1|ap1|pf[12]|h[123]|g[12]|s[12]|c1|f[123])$/.test(el.id))
          .map(el => ({ id: el.id, ...el.getBoundingClientRect().toJSON() })),
      }));
    const [refGeometry, geometry] = await Promise.all([measure(reference), measure(actual)]);
    // Only upper metric cards and chart containers have invariant geometry when truthful copy changes.
    const metrics = payload.cards.length;
    const differences = geometry.cards.slice(0, metrics).map((r, index) => ({
      type: 'metric',
      index,
      max: Math.max(
        ...['x', 'y', 'width', 'height'].map(key =>
          Math.abs(r[key] - refGeometry.cards[index][key]),
        ),
      ),
    }));
    const chartSizes = geometry.charts.map(r => {
      const ref = refGeometry.charts.find(c => c.id === r.id);
      return {
        id: r.id,
        max: Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(r[key] - ref[key]))),
      };
    });
    const chartPixels = [];
    for (const chart of geometry.charts) {
      const ref = reference.locator('#' + chart.id),
        live = actual.locator('#' + chart.id);
      const refPath = `${out}/${name}-${chart.id}-reference.png`,
        livePath = `${out}/${name}-${chart.id}-actual.png`;
      await ref.screenshot({ path: refPath, style: screenshotStyle });
      await live.screenshot({ path: livePath, style: screenshotStyle });
      const { diff, ...comparison } = await pixelDiff(refPath, livePath);
      fs.writeFileSync(`${out}/${name}-${chart.id}-diff.png`, Buffer.from(diff, 'base64'));
      chartPixels.push({ id: chart.id, reference: refPath, actual: livePath, ...comparison });
    }
    await reference.screenshot({
      path: `${out}/${name}-reference.png`,
      fullPage: true,
      style: screenshotStyle,
    });
    await actual.screenshot({
      path: `${out}/${name}-actual.png`,
      fullPage: true,
      style: screenshotStyle,
    });
    const textExemptions = [...(await exemptions(reference)), ...(await exemptions(actual))];
    const { diff, ...fullPagePixels } = await pixelDiff(
      `${out}/${name}-reference.png`,
      `${out}/${name}-actual.png`,
      textExemptions,
    );
    fs.writeFileSync(`${out}/${name}-diff.png`, Buffer.from(diff, 'base64'));
    results.push({
      name,
      metricGeometry: differences,
      chartGeometry: chartSizes,
      chartPixels,
      fullPagePixels,
      textExemptions,
      refGeometry,
      geometry,
    });
    await actual.unroute('**/api/liekan/**/report?*');
  }
  fs.writeFileSync(
    `${out}/geometry.json`,
    JSON.stringify(
      {
        head,
        viewport: 1440,
        fixture: 'frozen prototype data intercepted in isolated browser; no writes to analytics',
        results,
        passed:
          results.length === 11 &&
          results.flatMap(r => r.chartPixels).length === 22 &&
          results.every(
            r =>
              [...r.metricGeometry, ...r.chartGeometry].every(d => d.max <= 2) &&
              r.fullPagePixels.ratio <= 0.01 &&
              r.chartPixels.every(c => c.ratio <= 0.01),
          ),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      pages: results.length,
      charts: results.flatMap(r => r.chartPixels).length,
      maxMetricDelta: Math.max(...results.flatMap(r => r.metricGeometry).map(r => r.max)),
      maxChartDelta: Math.max(...results.flatMap(r => r.chartGeometry).map(r => r.max)),
    }),
  );
  if (
    results.length !== 11 ||
    results.flatMap(r => r.chartPixels).length !== 22 ||
    results.some(
      r =>
        [...r.metricGeometry, ...r.chartGeometry].some(d => d.max > 2) ||
        r.fullPagePixels.ratio > 0.01 ||
        r.chartPixels.some(c => c.ratio > 0.01),
    )
  )
    throw new Error('Prototype page, chart or metric geometry acceptance failed');
} finally {
  await browser.close();
}
