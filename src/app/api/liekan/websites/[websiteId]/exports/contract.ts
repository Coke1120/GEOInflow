import { z } from 'zod';
import { exportRequestSchema } from '@/lib/liekan/contracts/exports';
import {
  defineOperation,
  badRequestResponse,
  unauthorizedResponse,
  notFoundResponse,
  apiErrorSchema,
} from '@/lib/liekan/upstream/feature-api-contracts';
export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/exports',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'createLiekanExport',
      summary: '导出当前网站真实统计文件',
      description:
        '返回 NDJSON：progress 为实际文件生成/传输进度，file 为文件元数据与字段清单，chunk 为顺序 Base64 数据，complete 为完成。普通 CSV/JSON 使用 summary；ZIP 使用勾选范围；kind=source-keywords 的 CSV 导出全部筛选关键词及搜索引擎，包含读取时间与条件。取消请求终止传输。查询阶段超过 100000 明细行或 50 MiB 返回 413；传输阶段错误为 error 帧。',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: exportRequestSchema } },
      },
      responses: {
        200: {
          description: '有界真实文件生成与下载流',
          content: { 'application/x-ndjson': { schema: z.string() } },
        },
        400: badRequestResponse,
        401: unauthorizedResponse,
        403: {
          description: '无权访问资源',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
        404: notFoundResponse,
        501: {
          description: '当前数据引擎暂不支持',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
        413: {
          description: '导出超过上限，缩小范围后重试',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
      },
    },
  }),
] as const;
