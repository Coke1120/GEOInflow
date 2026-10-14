import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/geography/attribution',
    audience: 'public',
    auth: 'none',
    operation: {
      operationId: 'getLiekanGeographyAttribution',
      summary: 'Read public geography provider attribution',
      tags: ['Liekan'],
      responses: {
        '200': {
          description: 'Provider credit links without configuration or analytics',
          content: {
            'application/json': {
              schema: z.object({
                links: z.array(z.object({ label: z.string(), href: z.string() })),
              }),
            },
          },
        },
      },
    },
  }),
] as const;
