import { resolveAiTemplateConfig } from './templates';
import { aiConversationPostSchema } from './contracts';
import { AiError } from './error';
import { acceptAiRun, completeAiRun, saveAiContext, setAiRunStage } from './runs';
import { aiRunResponse } from './http';
import { decryptAiKey } from './crypto';
import { callAiModel } from './model';
import { localAiGuidance, resolveAiActions, validateAiAnswer } from './answer';
import { prepareAiPrompt, type AiHistoryTurn } from './prompt';
import { isAiContextEmpty } from './analysis-data';
import { normalizeAiRange } from './facts-contracts';
import { buildAiFactsContext } from '../upstream/ai-facts';
import { aiTransaction } from '../upstream/ai-db';
import { aiSpaceFromRow, type AiActor } from '../upstream/ai-access';
import { loadAiConversation } from './conversations';

async function completedHistory(actor: AiActor, id: string): Promise<AiHistoryTurn[]> {
  return aiTransaction(async tx => {
    const { row } = await loadAiConversation(tx, actor, id);
    const history = await tx.query<AiHistoryTurn>(
      "SELECT 'completed' AS state,m.question,m.result AS answer,c.facts AS context FROM liekan_ai_message m JOIN liekan_ai_run r ON r.id=m.run_id AND r.state='completed' JOIN liekan_ai_context c ON c.id=m.context_id AND c.expires_at>now() AND c.website_epoch=$2::uuid WHERE m.conversation_id=$1::uuid AND m.expires_at>now() AND m.result IS NOT NULL ORDER BY m.created_at DESC,m.id DESC LIMIT 6",
      id,
      row.website_epoch,
    );
    return history.reverse();
  });
}
export async function analyzeAiConversation(
  request: Request,
  actor: AiActor,
  id: string,
  input: unknown,
) {
  const parsed = aiConversationPostSchema.safeParse(input);
  if (!parsed.success) throw new AiError('invalid_request', '请确认问题、日期、时区与模型配置版本');
  const p = parsed.data;
  normalizeAiRange(p, new Date());
  const handle = await acceptAiRun(actor, { operation: 'analysis', targetId: id, ...p });
  return aiRunResponse(request, actor, handle, async ({ emit, signal }) => {
    await setAiRunStage(actor, handle, 'preparing');
    emit('stage', { stage: 'preparing', message: '正在读取授权网站的统计依据' });
    const context = await buildAiFactsContext({ actor, conversationId: id, input: p, signal });
    const connection = handle.connection;
    const unsupported = Object.values(context.sourceStates).every(state => state === 'unsupported');
    const empty = isAiContextEmpty(context);
    if (!connection || unsupported || empty) {
      signal.throwIfAborted();
      await saveAiContext(actor, handle, context);
      const answer = localAiGuidance(
        context,
        unsupported
          ? 'unsupported'
          : !connection
            ? p.localOnly
              ? 'local_only'
              : 'no_connection'
            : 'empty',
      );
      const result = {
        ...answer,
        actions: resolveAiActions(answer, context),
        metrics: context.metrics,
        contextId: context.id,
      };
      const saved = await completeAiRun(actor, handle, result, {
        ttftMs: null,
        usage: null,
        local: true,
        signal,
      });
      emit('answer', saved.result);
      emit('done', saved);
      return;
    }
    const prepared = prepareAiPrompt({
      context,
      question: p.question,
      history: await completedHistory(actor, id),
      connectionConfig: {
        provider: connection.provider,
        protocol: connection.protocol,
        baseUrl: connection.base_url,
        model: connection.model,
      },
    });
    const configuration = resolveAiTemplateConfig({
      provider: connection.provider,
      protocol: connection.protocol,
      baseUrl: connection.base_url,
      model: connection.model,
    });
    await saveAiContext(actor, handle, {
      ...prepared.contextSent,
      modelConfiguration: {
        connectionId: connection.id,
        configVersion: connection.config_version,
        provider: connection.provider,
        model: connection.model,
        region: configuration.region,
        contextWindow: configuration.contextWindow,
        contextWindowSource: configuration.contextWindowSource,
      },
      inputBudget: {
        bytes: prepared.inputBytes,
        tokenUpperBound: prepared.estimatedInputTokens,
        trimmed: prepared.trimmed,
      },
    });
    const apiKey = decryptAiKey(connection.secret_envelope, {
      connectionId: connection.id,
      space: aiSpaceFromRow(connection),
    });
    signal.throwIfAborted();
    await setAiRunStage(actor, handle, 'calling');
    emit('stage', {
      stage: 'calling',
      message: '正在生成分析，预览尚未校验',
      trimmed: prepared.trimmed,
    });
    const response = await callAiModel({
      connection,
      apiKey,
      system: prepared.system,
      prompt: prepared.prompt,
      maxOutputTokens: 2048,
      signal,
      stream: connection.capabilities.keyVerified.stream === true,
      jsonOutput: true,
      schema:
        connection.capabilities.keyVerified.structuredOutput === true ? prepared.schema : undefined,
      onText: text => emit('delta', { text, validated: false }),
    });
    signal.throwIfAborted();
    await setAiRunStage(actor, handle, 'validating');
    signal.throwIfAborted();
    emit('stage', { stage: 'validating', message: '正在核对回答结构、依据与页面入口' });
    const answer = validateAiAnswer(response.output ?? response.text, prepared.allowedContexts);
    const result = {
      ...answer,
      actions: resolveAiActions(answer, context),
      metrics: context.metrics,
      contextId: context.id,
    };
    const saved = await completeAiRun(actor, handle, result, {
      ttftMs: response.ttftMs,
      usage: response.usage,
      stream: response.stream,
      signal,
    });
    emit('answer', saved.result);
    emit('done', saved);
  });
}
