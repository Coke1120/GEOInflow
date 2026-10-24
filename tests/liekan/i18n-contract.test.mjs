import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertDisplayMetadata,
  assertIdentityTranslations,
  assertLanguagePair,
} from '../../scripts/liekan-i18n-contract.mjs';
const pair = (source, english) => {
  const key = `m_${createHash('sha256').update(source).digest('hex').slice(0, 12)}`;
  return [{ [key]: source }, { [key]: english }];
};
test('accepts complete, stable bilingual messages and preserved executable literals', () => {
  assert.doesNotThrow(() => assertLanguagePair(...pair('已读取 {v0} 条记录', 'Read {v0} records')));
  assert.doesNotThrow(() => assertLanguagePair(...pair('eq.AI 搜索引荐', 'eq.AI 搜索引荐')));
});
test('preserves the approved footer personal names across locales', () => {
  for (const name of ['姚金刚', '向阳乔木']) {
    assert.doesNotThrow(() => assertLanguagePair(...pair(name, name)));
    assert.throws(() => assertLanguagePair(...pair(name, 'Author')), /Personal name changed/);
  }
});
test('refuses missing or empty translations and changed stable identities', () => {
  const [zh, en] = pair('已保存', 'Saved');
  assert.throws(() => assertLanguagePair(zh, {}), /key\/order mismatch/);
  assert.throws(() => assertLanguagePair(zh, { [Object.keys(en)[0]]: '' }), /Empty English/);
  assert.throws(() => assertLanguagePair({ bad: '已保存' }, { bad: 'Saved' }), /identity changed/);
});
test('refuses lost or reordered placeholders and untranslated display text', () => {
  assert.throws(
    () => assertLanguagePair(...pair('{v0}至{v1}', '{v1} to {v0}')),
    /placeholders differ/,
  );
  assert.throws(() => assertLanguagePair(...pair('已保存', '已保存')), /Unreviewed Chinese/);
});
test('refuses changing protected code or using its exception for unrelated Chinese', () => {
  assert.throws(
    () => assertLanguagePair(...pair('eq.AI 搜索引荐', 'eq.AI search referrals')),
    /Executable/,
  );
  assert.throws(() => assertLanguagePair(...pair('加载中', 'Loading中')), /Unreviewed Chinese/);
});
test('checks application metadata recursively without translating identifiers', () => {
  const metadata = {
    pages: [{ id: '原始标识', title: '安装验证', summary: ' 接入检查 ' }],
    tabs: [{ label: '目标' }],
  };
  assert.doesNotThrow(() => assertDisplayMetadata(metadata, ['安装验证', '接入检查', '目标']));
  assert.throws(
    () => assertDisplayMetadata(metadata, ['安装验证', '接入检查']),
    /Missing English metadata.*目标/,
  );
});
test('checks titles generated for existing-resource editor states', () => {
  const metadata = { pages: [{ id: 'goal-editor', title: '创建目标' }] };
  assert.doesNotThrow(() => assertDisplayMetadata(metadata, ['创建目标', '编辑目标']));
  assert.throws(
    () => assertDisplayMetadata(metadata, ['创建目标']),
    /Missing English metadata.*编辑目标/,
  );
});
test('keeps action and form identifiers canonical while permitting static anonymous readonly display labels', () => {
  assert.doesNotThrow(() => assertIdentityTranslations('<ManagementDrawer action="对比上周" />'));
  assert.doesNotThrow(() =>
    assertIdentityTranslations('<TableCell sortValue={i18n.source("用户")} />'),
  );
  assert.throws(
    () => assertIdentityTranslations('<TableCell sortValue={i18n.text("用户")} />'),
    /identity attribute/,
  );
  assert.throws(
    () => assertIdentityTranslations('<TableCell sortValue={i18n.english.text("用户")} />'),
    /identity attribute/,
  );
  assert.throws(
    () => assertIdentityTranslations('<ManagementDrawer action={i18n.text("对比上周")} />'),
    /identity attribute/,
  );
  assert.doesNotThrow(() =>
    assertIdentityTranslations('<Field value={i18n.text("普通用户")} readOnly />'),
  );
  assert.throws(
    () =>
      assertIdentityTranslations('<Field name="role" value={i18n.text("普通用户")} readOnly />'),
    /identity attribute/,
  );
  assert.throws(
    () => assertIdentityTranslations('<Field value={i18n.system(user.name)} readOnly />'),
    /identity attribute/,
  );
  assert.throws(
    () => assertIdentityTranslations('<Field value={i18n.text("普通用户")} readOnly={false} />'),
    /identity attribute/,
  );
});

test('checks owned TS metadata and fails if its declared source disappears', async () => {
  const { assertOwnedSourceMetadata } = await import('../../scripts/liekan-i18n-contract.mjs');
  const source = `export const templates = [{id: '原始标识', name: '原始品牌', notes: ['服务器一次安装'], region: '北京'}];`;
  assert.doesNotThrow(() =>
    assertOwnedSourceMetadata(source, { templates: ['notes', 'region'] }, [
      '服务器一次安装',
      '北京',
    ]),
  );
  assert.throws(
    () => assertOwnedSourceMetadata(source, { templates: ['notes', 'region'] }, ['北京']),
    /owned metadata.*服务器一次安装/,
  );
  assert.throws(
    () => assertOwnedSourceMetadata(source, { missing: '*' }, []),
    /declaration missing/,
  );
});

test('English browser guards inspect real GEO labels, chart states, owned auth copy and read failures', async () => {
  const { JSDOM } = await import('jsdom');
  const { englishPageGeometry, englishChartsReady, assertRenderedEnglishState } = await import(
    '../../scripts/liekan-i18n-visual.mjs'
  );
  const oldDocument = globalThis.document,
    oldWidth = globalThis.innerWidth;
  const setBody = html => {
    globalThis.document = new JSDOM(html).window.document;
    globalThis.innerWidth = 1440;
  };
  try {
    setBody(
      '<main><p data-liekan-metric-label>Visitors</p><div data-liekan-chart-state="data"></div></main>',
    );
    assert.equal(englishPageGeometry().analyticsCards, 1);
    assert.equal(englishChartsReady(), false, 'A data chart without canvas cannot count as ready');
    document
      .querySelector('[data-liekan-chart-state]')
      .appendChild(document.createElement('canvas'));
    assert.equal(englishChartsReady(), true);
    assert.doesNotThrow(() => assertRenderedEnglishState(englishPageGeometry(), true));
    document
      .querySelector('[data-liekan-chart-state]')
      .setAttribute('data-liekan-chart-state', 'failed');
    assert.equal(englishChartsReady(), false);
    document
      .querySelector('[data-liekan-chart-state]')
      .setAttribute('data-liekan-chart-state', 'empty');
    assert.equal(englishChartsReady(), true, 'A declared empty state remains supported');
    setBody(
      '<main><table><thead><tr><th>Crawler</th></tr></thead><tbody><tr><td>No data in the current range.</td></tr></tbody></table></main>',
    );
    assert.doesNotThrow(() => assertRenderedEnglishState(englishPageGeometry(), 'table'));
    assert.throws(() => assertRenderedEnglishState(englishPageGeometry(), true), /analytics cards/);
    setBody('<main><table><thead><tr><th>Crawler</th></tr></thead><tbody></tbody></table></main>');
    assert.throws(
      () => assertRenderedEnglishState(englishPageGeometry(), 'table'),
      /analytics table/,
    );
    setBody(
      '<aside data-liekan-auth-copy><h1>从 AI 与搜索访问</h1></aside><main><h1>Welcome back</h1></main>',
    );
    assert.throws(() => assertRenderedEnglishState(englishPageGeometry()), /Owned interface text/);
    setBody('<main><div class="state-box"><h3>Load failed</h3></div></main>');
    assert.throws(() => assertRenderedEnglishState(englishPageGeometry()), /Fixture data read/);
    setBody('<main></main>');
    assert.throws(
      () => assertRenderedEnglishState(englishPageGeometry(), true),
      /Rendered page body/,
    );
  } finally {
    globalThis.document = oldDocument;
    globalThis.innerWidth = oldWidth;
  }
});

test('English route, snapshot and request guards refuse wrong views and empty statistics', async () => {
  const { assertEnglishRouteIdentity, assertNumericSnapshot, isStatisticsRequest } = await import(
    '../../scripts/liekan-i18n-visual.mjs'
  );
  const route = { id: 'preferences', path: '/liekan/preferences', documentTitle: '偏好设置' };
  assert.throws(
    () =>
      assertEnglishRouteIdentity(route, 'http://127.0.0.1:3302/login', 'Preferences | GEOInflow'),
    /correct page route/,
  );
  assert.throws(
    () =>
      assertEnglishRouteIdentity(
        route,
        'http://127.0.0.1:3302/liekan/preferences',
        'Wrong view | GEOInflow',
      ),
    /document title/,
  );
  assert.throws(() => assertNumericSnapshot([]), /actual numeric/);
  assert.throws(() => assertNumericSnapshot([[], []]), /actual numeric/);
  assert.doesNotThrow(() => assertNumericSnapshot([['0'], ['40']]));
  assert(
    isStatisticsRequest('http://127.0.0.1:3302/api/liekan/websites/site/page-report?date=7day'),
  );
  assert(isStatisticsRequest('http://127.0.0.1:3302/api/liekan/websites/site/keywords/export'));
  assert(!isStatisticsRequest('http://127.0.0.1:3302/api/liekan/geography/attribution'));
});
