import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  referenceColumns,
  approveCrawlerPagesReference,
} from '../../scripts/liekan-visual-baseline.mjs';

test('crawler prototype fields retain their original positions after adding the title column', () => {
  const current = {
    apBody: [
      ['path', '页面'],
      ['title', '标题'],
      ['requests', '抓取次数'],
      ['bots', '蜘蛛种类'],
      ['heat', '抓取热度'],
      ['bot', '主力蜘蛛'],
      ['lastSeen', '最近抓取'],
      ['freshness', '内容新鲜度'],
    ],
    topBody: [
      ['path', '页面'],
      ['humanPv', '浏览 PV'],
    ],
  };
  const original = structuredClone(current);
  // The immutable HTML fixture supplies seven cells, with no title cell.
  const cells = ['/cases/housty', '486', '9', '96', 'GPTBot · 182 次', '2 分钟前', '本周更新'];
  const row = fields => Object.fromEntries(fields.map(([key], index) => [key, cells[index]]));
  const expected = {
    path: '/cases/housty',
    requests: '486',
    bots: '9',
    heat: '96',
    bot: 'GPTBot · 182 次',
    lastSeen: '2 分钟前',
    freshness: '本周更新',
  };
  // The pre-fix positional mapping must be rejected by the same oracle.
  assert.throws(() => assert.deepEqual(row(current.apBody), expected));
  assert.deepEqual(row(referenceColumns(current).apBody), expected);
  assert.deepEqual(referenceColumns(current).topBody, current.topBody);
  assert.deepEqual(current, original);
  assert.equal(
    referenceColumns(current).apBody.some(([key]) => key === 'title'),
    false,
  );
});

test('the supplemental reference preserves original panels and charts while adding bounded crawler controls', () => {
  const html = readFileSync('design/reference/geo-stats-v3/ai-pages.html', 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  try {
    const document = dom.window.document;
    const table = document.querySelector('#apBody');
    table.innerHTML =
      '<tr><td>/page</td><td>486</td><td>9</td><td><span>96</span></td><td>GPTBot</td><td>2 分钟前</td><td>本周更新</td></tr>';
    const expected = [
      '页面',
      '标题',
      '抓取次数',
      '蜘蛛种类',
      '抓取热度',
      '主力蜘蛛',
      '最近抓取',
      '内容新鲜度',
    ];
    const headers = () =>
      [...table.closest('table').querySelectorAll('th')].map(el => el.textContent.trim());
    assert.throws(() => assert.deepEqual(headers(), expected));
    const chart = document.getElementById('ap1').outerHTML;
    const panels = document.querySelectorAll('main .card').length;
    dom.window.eval(
      `(${approveCrawlerPagesReference.toString()})(${JSON.stringify({
        table: 'apBody',
        addedColumn: { label: '标题' },
        crawlerSelector: '具体爬虫',
        defaultCrawler: '全部爬虫',
        typeFilters: ['全部', 'AI 训练', 'AI 搜索', '用户触发', '传统搜索', 'AI 工作台', '个人 Agent', '其他爬虫'],
      })})`,
    );
    assert.deepEqual(headers(), expected);
    assert.equal(table.rows[0].cells[1].textContent, '未提供');
    assert.equal(table.rows[0].cells[2].textContent, '486');
    assert.equal(table.rows[0].cells[4].textContent, '96');
    assert.equal(document.querySelector('select[aria-label="具体爬虫"]').textContent, '全部爬虫');
    assert.deepEqual(
      [...table.closest('table').previousElementSibling.children].map(el => el.textContent),
      ['全部', 'AI 训练', 'AI 搜索', '用户触发', '传统搜索', 'AI 工作台', '个人 Agent', '其他爬虫'],
    );
    assert.equal(document.querySelectorAll('main .card').length, panels);
    assert.equal(document.getElementById('ap1').outerHTML, chart);
    assert.equal(readFileSync('design/reference/geo-stats-v3/ai-pages.html', 'utf8'), html);
  } finally {
    dom.window.close();
  }
});
