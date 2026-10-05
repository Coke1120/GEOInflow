import { z } from 'zod';
import { sharedReportQuery, sharedReportSchema } from '@/lib/liekan/contracts/shared-report';
import { defineOperation } from '@/openapi/operation';
import { badRequestResponse, notFoundResponse, unauthorizedResponse } from '@/openapi/schemas';

export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/shared-report',
    audience: 'public',
    auth: 'bearer-or-share',
    operation: {
      operationId: 'getLiekanSharedReport',
      summary:
        'Read aggregate website statistics authorized by a live overview share or complete login',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }), query: sharedReportQuery },
      responses: {
        '200': {
          description: 'Read-only aggregate dashboard',
          content: { 'application/json': { schema: sharedReportSchema } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': { description: 'Share scope does not permit this website overview' },
        '404': notFoundResponse,
      },
    },
  }),
] as const;
