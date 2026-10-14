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
