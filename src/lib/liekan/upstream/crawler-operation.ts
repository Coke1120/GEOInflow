import { z } from 'zod';
import { crawlerResponseSchema } from '../contracts/crawler-responses';
import { defineOperation, type ApiHttpMethod } from '@/openapi/operation';
import {
  badRequestResponse,
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@/openapi/schemas';

export function crawlerOperation(
  method: ApiHttpMethod,
  path: `/${string}`,
  operationId: string,
  body?: z.ZodType,
  response?: z.ZodType,
  query?: z.ZodObject<any>,
) {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
  return defineOperation({
    method,
    path,
    audience: 'internal',
    auth: 'bearer',
    operation: {
      operationId,
      summary: operationId,
      tags: ['Liekan'],
      requestParams: {
        path: z.object(
          Object.fromEntries(
            names.map(name => [
              name,
              name === 'findingKey' ? z.string().regex(/^cr_[a-f0-9]{64}$/) : z.uuid(),
            ]),
          ),
        ),
        ...(query ? { query } : {}),
      },
      ...(body
        ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } }
        : {}),
      responses: {
        '200': {
          description: 'Authenticated website crawler operation',
          content: {
            'application/json': { schema: response ?? crawlerResponseSchema(operationId) },
          },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': forbiddenResponse,
        '404': notFoundResponse,
        '409': { description: 'Version, context, remote state or preview conflict' },
        '429': { description: 'Bounded rate exceeded' },
        '503': { description: 'Database, worker or provider unavailable' },
      },
    },
  });
}
