import { z } from 'zod';
import {
  teamUserCreateSchema,
  teamUserReadQuery,
  teamUserResultSchema,
} from '@/lib/liekan/contracts/team-users';
import { defineOperation, apiErrorSchema } from '@/lib/liekan/upstream/feature-api-contracts';

const responses = {
  '200': {
    description: 'Confirmed account and membership, or an unresolved creation outcome',
    content: { 'application/json': { schema: teamUserResultSchema } },
  },
  ...Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 500].map(status => [
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
    method: 'post',
    path: '/api/liekan/teams/{teamId}/users/create',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'createLiekanTeamUser',
      summary: 'Create a regular account and join the team atomically',
      description:
        'Requires a complete administrator login session. API keys and share identities are rejected. The system role is fixed to user.',
      tags: ['Liekan'],
      requestParams: { path: z.object({ teamId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: teamUserCreateSchema } },
      },
      responses,
    },
  }),
  defineOperation({
    method: 'get',
    path: '/api/liekan/teams/{teamId}/users/create',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'readLiekanTeamUserCreation',
      summary: 'Reconcile a team account creation through read-only metadata',
      description:
        'Requires a complete administrator login session. This operation never creates an account, changes a password or restores membership.',
      tags: ['Liekan'],
      requestParams: { path: z.object({ teamId: z.uuid() }), query: teamUserReadQuery },
      responses,
    },
  }),
];
