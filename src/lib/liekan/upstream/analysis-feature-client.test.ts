import { afterEach, expect, it, vi } from 'vitest';
import { featureApi } from './features-client';
const site='11111111-1111-4111-8111-111111111111';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('queues five cold modules within two active durable submissions until each result completes',async()=>{
 vi.useFakeTimers();
 let active=0,maximum=0,submitted=0;
 const jobs=new Map<string,any>();
 vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
   const url=new URL(String(input));
   if(url.pathname.endsWith('/stats')){
     active++;maximum=Math.max(maximum,active);submitted++;
     const id=`aaaaaaaa-aaaa-4aaa-8aaa-${String(submitted).padStart(12,'0')}`;
     const job={id,websiteId:site,status:'queued',queuedAt:'2026-10-01',startedAt:null,completedAt:null,generatedAt:null,expiresAt:null,errorCode:null,retryAfterMs:3000,resultUrl:`/liekan/websites/${site}/analytics-jobs/${id}/result`};
     jobs.set(id,job);return Response.json({analysisJob:job},{status:202});
   }
   const id=url.pathname.split('/').filter(Boolean).at(-1)==='result'?url.pathname.split('/').at(-2):url.pathname.split('/').at(-1);
   const job=jobs.get(id);expect(job).toBeTruthy();
   if(url.pathname.endsWith('/result')){active--;return Response.json({pageviews:7});}
   return Response.json({analysisJob:{...job,status:'ready'}});
 }));
 const requests=Array.from({length:5},(_,n)=>featureApi.get(`/websites/${site}/stats`,{startAt:0,endAt:1000+n}));
 const complete=Promise.all(requests);
 await vi.advanceTimersByTimeAsync(1);expect(submitted).toBe(2);
 await vi.advanceTimersByTimeAsync(10000);
 expect(await complete).toHaveLength(5);expect(maximum).toBe(2);expect(submitted).toBe(5);expect(active).toBe(0);
});
