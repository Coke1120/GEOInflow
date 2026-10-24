import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import { badRequestResponse,unauthorizedResponse,forbiddenResponse,notFoundResponse } from '@/openapi/schemas';
import { analysisAcceptedSchema,analysisWebsiteListSchema,analysisStatusSchema,analysisBuildSchema,analysisBuildInputSchema,analysisActionSchema } from '@/lib/liekan/contracts/analysis-acceleration';
export const operations=[defineOperation({
 method:"get",path:"/api/liekan/websites/{websiteId}/analytics-jobs/{jobId}/result",audience:'public',auth:'bearer',operation:{
  operationId:"getLiekanAnalysisJobResult",summary:'Private statistics acceleration (complete session and current website authority required)',tags:['Liekan'],
  requestParams:{path:z.object({websiteId:z.uuid(),jobId:z.uuid(),}),},
  responses:{'200':{description:'Authorized acceleration state or the original registered query DTO',content:{'application/json':{schema:z.unknown()}}},'202':{description:'The task remains queued or running; retry after three seconds',content:{'application/json':{schema:analysisAcceptedSchema}}},
   '400':badRequestResponse,'401':unauthorizedResponse,'403':forbiddenResponse,'404':notFoundResponse,
   '409':{description:'Revision or scope changed; reload current state'},'410':{description:'The task or its result is expired or invalidated'},
   '429':{description:'Per consumer, website, global admission or refresh limit reached'},'501':{description:'PostgreSQL support required'},'503':{description:'Bounded work failed or background capacity is unavailable'},
  }
 }
})] as const;
