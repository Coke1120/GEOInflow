import { z } from 'zod';
import { installationActionSchema } from '@/lib/liekan/contracts/installation';
import { defineOperation } from '@/openapi/operation';
import {
  badRequestResponse,
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@/openapi/schemas';

const responses = {
  '200': {
    description: 'Website installation progress',
    content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
  },
  '400': badRequestResponse,
  '401': unauthorizedResponse,
  '403': forbiddenResponse,
  '404': notFoundResponse,
};
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/installation',
    audience: 'internal',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanInstallation',
      summary: 'Read website installation progress and log receipts',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      responses,
    },
  }),
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/installation',
    audience: 'internal',
    auth: 'bearer',
    operation: {
      operationId: 'saveLiekanInstallation',
      summary: 'Save website installation guide progress',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: installationActionSchema } },
      },
      responses,
    },
  }),
] as const;
