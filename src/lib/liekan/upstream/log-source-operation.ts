import { z } from 'zod';
import { defineOperation, type ApiAuth, type ApiHttpMethod } from '@/openapi/operation';
import {
  badRequestResponse,
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@/openapi/schemas';
export function logSourceOperation(
  method: ApiHttpMethod,
  path: `/${string}`,
  operationId: string,
  auth: ApiAuth,
  body?: z.ZodType,
  options: { redirect?: boolean; batch?: boolean } = {},
) {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
  return defineOperation({
    method,
    path,
    audience: 'internal',
    auth,
    operation: {
      operationId,
      summary: operationId,
      tags: ['Liekan'],
      ...(names.length
        ? {
            requestParams: {
              path: z.object(Object.fromEntries(names.map(name => [name, z.uuid()]))),
            },
          }
        : {}),
      ...(body
        ? {
            requestBody: {
              required: true,
              description: options.batch
                ? 'Server protocol JSON, or Cloudflare NDJSON. Optional gzip Content-Encoding. Compressed limit 5 MiB; decoded limit 10 MiB; 1000 events.'
                : undefined,
              content: {
                'application/json': { schema: body },
                ...(options.batch
                  ? {
                      'application/x-ndjson': { schema: z.string() },
                      'application/octet-stream': { schema: z.string() },
                    }
                  : {}),
              },
            },
          }
        : {}),
      responses: {
        ...(options.redirect
          ? {
              '303': {
                description: 'Return to authenticated website setup after staging authorization',
                headers: { Location: { schema: { type: 'string' as const } } },
              },
            }
          : {
              '200': {
                description: 'Successful log ingestion operation',
                content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
              },
            }),
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': forbiddenResponse,
        '404': notFoundResponse,
        '409': { description: 'Source, epoch, event identity or configuration conflict' },
        '429': { description: 'Bounded rate or backlog capacity exceeded; retry later' },
        '503': {
          description: 'Persistent receiver or provider configuration unavailable; retry later',
        },
      },
    },
  });
}
