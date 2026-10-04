import { aiCatalogQuerySchema } from '@/lib/liekan/ai/api-contracts';
import { AiError } from '@/lib/liekan/ai/error';
import { aiApi } from '@/lib/liekan/ai/http';
import { getAiModuleState } from '@/lib/liekan/ai/crypto';
import { AI_TEMPLATES } from '@/lib/liekan/ai/templates';
import { getAiAccessCatalog } from '@/lib/liekan/upstream/ai-catalog';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return aiApi(request, async actor => {
    const parsed = aiCatalogQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) throw new AiError('invalid_request', 'AI 目录参数无效');
    const state = getAiModuleState();
    return {
      protocolVersion: 1,
      module: state.enabled
        ? { enabled: true }
        : { enabled: false, reason: 'reason' in state ? state.reason : 'feature_disabled' },
      templates: AI_TEMPLATES,
      ...(await getAiAccessCatalog(actor, parsed.data)),
      limits: {
        connectionsPerSpace: 20,
        maxDays: 90,
        maxQuestionCharacters: 2000,
        dailyRequests: 100,
        quotaTimezone: 'UTC',
      },
    };
  });
}
