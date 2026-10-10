import { logSourceOperation } from '@/lib/liekan/upstream/log-source-operation';
export const operations = [
  logSourceOperation(
    'get',
    '/api/liekan/websites/{websiteId}/log-sources/server/deployment',
    'getLiekanDockerDeployment',
    'bearer',
  ),
] as const;
