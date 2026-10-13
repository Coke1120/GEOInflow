import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
} from '@/openapi/schemas';

export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/liekan/collect',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'collectLiekanServerEvent',
      summary: 'Collect an authorized server event with Umami payload fields',
      tags: ['Liekan'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              type: z.enum(['event', 'identify', 'performance']),
              payload: z
                .object({ website: z.uuid(), eventId: z.uuid().optional() })
                .catchall(z.unknown()),
            }),
          },
        },
      },
      responses: {
        '200': {
          description: 'Umami collection response or bot acknowledgement',
          content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': forbiddenResponse,
        '404': notFoundResponse,
        '409': { description: 'Event ID reused for different content' },
      },
    },
  }),
] as const;
