import {
  accountPreferencesSchema,
  initializeAccountPreferencesSchema,
  saveAccountPreferencesSchema,
} from '@/lib/liekan/contracts/account-preferences';
import { apiErrorSchema, defineOperation } from '@/lib/liekan/upstream/feature-api-contracts';

const responses = {
  '200': {
    description: 'Current account country, timezone and date preferences',
    content: { 'application/json': { schema: accountPreferencesSchema } },
  },
  ...Object.fromEntries(
    [400, 401, 413, 500].map(status => [
      String(status),
      {
        description: 'Request rejected or service unavailable',
        content: { 'application/json': { schema: apiErrorSchema } },
      },
    ]),
  ),
};

export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/account/preferences',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'readLiekanAccountPreferences',
      summary: 'Read the current account preferences',
      description:
        'Requires a complete login session. Reading an unconfigured account returns the China and Today defaults without creating a record.',
      tags: ['Liekan'],
      responses,
    },
  }),
  defineOperation({
    method: 'post',
    path: '/api/liekan/account/preferences',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'initializeLiekanAccountPreferences',
      summary: 'Initialize account preferences once from legacy browser values',
      description:
        'Requires a complete login session. Existing server preferences always win. Initialization leaves country and timezone confirmation pending.',
      tags: ['Liekan'],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: initializeAccountPreferencesSchema } },
      },
      responses,
    },
  }),
  defineOperation({
    method: 'patch',
    path: '/api/liekan/account/preferences',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'saveLiekanAccountPreferences',
      summary: 'Confirm and save the current account preferences',
      description:
        'Requires a complete login session and an explicit country and matching timezone. API keys and public share identities are rejected.',
      tags: ['Liekan'],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: saveAccountPreferencesSchema } },
      },
      responses,
    },
  }),
];
