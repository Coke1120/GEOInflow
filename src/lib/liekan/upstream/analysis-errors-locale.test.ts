import {expect,it} from 'vitest';
import {translateSystemText} from '../i18n/text';
it('translates task failure, capacity and invalidation states without changing identifiers',()=>{
 for(const message of ['后台统计读取失败','后台统计计算失败，请缩小范围或重试','统计条件已变化，请重新读取','统计结果空间已达上限','统计加速状态已变化，请刷新']) {
  const text=translateSystemText(message,'en-US');
  expect(text).not.toMatch(/[\u4e00-\u9fff]/);
  expect(text.length).toBeGreaterThan(10);
 }
 expect(translateSystemText('analysis-concurrency-limited','en-US')).toBe('analysis-concurrency-limited');
});
