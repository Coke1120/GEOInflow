import type { AiProviderResponse } from './contracts';
export class AiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryAfter?: number,
    public providerResponse?: AiProviderResponse | null,
  ) {
    super(message);
  }
}
export function safeAiError(error: unknown) {
  if (error instanceof AiError)
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryAfter: error.retryAfter,
    };
  return { code: 'ai_unavailable', message: 'AI 服务暂时不可用，请稍后查看任务状态', status: 503 };
}
