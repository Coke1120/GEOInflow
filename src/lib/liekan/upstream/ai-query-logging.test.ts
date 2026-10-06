import {expect,it} from 'vitest';
import {privateAiQueryLog} from './ai-query-logging';
it('omits AI query parameters even when general database debugging is enabled',()=>{
 const event={query:'INSERT INTO liekan_ai_message(question) VALUES ($1)',params:'["private-key-canary"]',duration:3};
 expect(JSON.stringify(privateAiQueryLog(event))).not.toContain('private-key-canary');
 expect(privateAiQueryLog({query:'SELECT count(*) FROM website_event',params:'[]',duration:2})).toEqual({query:'SELECT count(*) FROM website_event',params:'[]',duration:2});
});
