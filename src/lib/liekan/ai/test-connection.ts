import { z } from 'zod';
import { AiError } from './error';
import { acceptAiRun, setAiRunStage, completeAiRun } from './runs';
import { aiRunResponse, type AiExecution } from './http';
import { readAiBody } from './http';
import { aiSpaceFromRow, type AiActor } from '../upstream/ai-access';
import { decryptAiKey } from './crypto';
import { callAiModel } from './model';
const testInput = z.strictObject({
  clientRequestId: z.uuid(),
  expectedConfigVersion: z.number().int().positive(),
});
export async function testAiConnection(request: Request, actor: AiActor, id: string) {
  const parsed = testInput.safeParse(await readAiBody(request));
  if (!parsed.success) throw new AiError('invalid_request', '测试参数无效');
  const handle = await acceptAiRun(actor, { operation: 'test', targetId: id, ...parsed.data });
  return aiRunResponse(request, actor, handle, executeAiTest);
}
export async function executeAiTest({ actor, handle, signal, emit }: AiExecution) {
  const connection = handle.connection;
  if (!connection) throw new AiError('invalidated', '连接已失效', 409);
  await setAiRunStage(actor, handle, 'preparing');
  emit('stage', { stage: 'preparing', label: '校验当前配置与连接权限' });
  const apiKey = decryptAiKey(connection.secret_envelope, {
    connectionId: connection.id,
    space: aiSpaceFromRow(connection),
  });
  await setAiRunStage(actor, handle, 'calling');
  emit('stage', { stage: 'calling', label: '已发送短文本测试；本次可能产生供应商费用' });
  let firstText = true;
  const result = await callAiModel({
    connection,
    apiKey,
    system: '你正在执行接口连通测试。请仅回复短文本，不调用工具。',
    prompt: '请回复：LIEKAN_OK，连接成功。',
    maxOutputTokens: 512,
    signal,
    stream: connection.capabilities.documented.stream === true,
    onText: text => {
      if (firstText) {
        firstText = false;
        emit('stage', { stage: 'first_text', label: '已收到首个可展示文本' });
      }
      emit('delta', { text, preview: true });
    },
  });
  if (!result.text.includes('LIEKAN_OK'))
    throw new AiError(
      'test_incomplete',
      '收到响应，文本测试未完成。请检查模型输出后重新测试。',
      502,
      undefined,
      result.providerResponse,
    );
  await setAiRunStage(actor, handle, 'validating');
  emit('stage', { stage: 'validating', label: '保存已验证的文本响应' });
  const saved = await completeAiRun(
    actor,
    handle,
    {
      text: result.text,
      origin: 'provider',
      provider: connection.provider,
      model: connection.model,
      providerResponse: result.providerResponse,
    },
    { ttftMs: result.ttftMs, usage: result.usage, stream: result.stream },
  );
  emit('answer', saved.result);
  emit('done', saved);
}
