import { LiekanError } from './upstream/server';
export async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new LiekanError('请求内容为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 11 * 1024 * 1024) {
      await reader.cancel();
      throw new LiekanError('文件上限 10 MiB', 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new LiekanError('JSON 无效');
  }
}
export async function api(work: () => Promise<unknown>) {
  try {
    return Response.json(await work(), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const status = error instanceof LiekanError ? error.status : 500;
    return Response.json(
      {
        error: {
          message: error instanceof LiekanError ? error.message : '数据查询失败，请检查服务状态',
          status,
          code: 'liekan-error',
        },
      },
      { status },
    );
  }
}
