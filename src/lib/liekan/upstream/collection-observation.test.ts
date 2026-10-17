import { describe, it, expect } from 'vitest';
import { observeCollection } from './collection-observation';
describe('B-01 finite request observation', () => {
  it('keeps only finite features and separates absent and invalid headers', () => {
    const observation = observeCollection(
      new Request('https://example.com/api/send', {
        headers: {
          accept: 'text/html, application/json, */*',
          'accept-language': 'zh-CN, en;q=0.8',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'new-mode',
          'sec-fetch-dest': 'image',
          authorization: 'private-secret',
          cookie: 'private-cookie',
          'user-agent': 'private-UA',
        },
      }),
    );
    expect(observation.features.accept).toEqual({
      state: 'present',
      values: ['html', 'json', 'wildcard'],
    });
    expect(observation.features.mode.values).toEqual(['other']);
    expect(JSON.stringify(observation)).not.toMatch(/zh-cn|private|authorization|cookie/i);
    const invalid = observeCollection({
      headers: new Headers({ accept: 'bad input', 'sec-fetch-mode': 'a b' }),
    });
    expect(invalid.features.accept.state).toBe('invalid');
    expect(invalid.features.mode.state).toBe('invalid');
    expect(invalid.features.site.state).toBe('missing');
  });
});
