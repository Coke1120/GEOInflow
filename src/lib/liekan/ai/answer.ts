import { z } from 'zod';
import { featureHref } from '@/components/liekan/features/routes';
import { aiUuidSchema } from './contracts';
import { AiError } from './error';
import type { AiFactsContext } from './facts-contracts';
import type { LiekanLocale } from '../i18n/locale';
import { translateText } from '../i18n/text';
import { aiActionLabels } from '../contracts/ai-display';

export const aiActionSchema = z.enum([
  'geo-ai',
  'geo-bots',
  'geo-ai-pages',
  'geo-logs',
  'geo-sources',
  'geo-content',
  'geo-conversions',
  'tracking',
]);
const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      value =>
        !/!\[|<[^>]*>|(?:[a-z][a-z0-9+.-]*:\/\/|javascript:|data:|mailto:)|\]\s*(?:\(|\[|:)/i.test(
          value,
        ),
      '仅允许纯文本。',
    );
const ref = z.strictObject({
  contextId: aiUuidSchema,
  factId: z.enum(['summary', 'bots', 'log-errors', 'ai-referrals', 'pages', 'goals']),
});
const refs = z.array(ref).min(1).max(12);
export const aiAnswerSchema = z.strictObject({
  summary: plain(1000),
  observations: z.array(z.strictObject({ text: plain(600), refs })).max(12),
  possibleCauses: z
    .array(
      z.strictObject({
        // JSON Schema carries this pattern to the model as well as the server validator.
        text: plain(600).regex(
          /可能|或许|也许|待核|待验证|尚需|无法确定|\b(?:[mM][aA][yY]|[mM][iI][gG][hH][tT]|[cC][oO][uU][lL][dD]|[pP][oO][sS][sS][iI][bB][lL][eE]|[uU][nN][cC][eE][rR][tT][aA][iI][nN])\b/,
          '可能原因需要明确保留不确定性。',
        ),
        refs,
        uncertainty: z.literal('possible'),
      }),
    )
    .max(12),
  suggestions: z
    .array(
      z.strictObject({
        text: plain(600),
        refs: z.array(ref).max(12),
        action: aiActionSchema.optional(),
      }),
    )
    .max(12),
  limitations: z.array(plain(600)).max(12),
});
export type AiModelAnswer = z.infer<typeof aiAnswerSchema>;
export type AiAnswerRef = z.infer<typeof ref> & {
  historical?: { startAt: string; endAt: string; asOf: string };
};
export interface AiAnswer {
  summary: string;
  observations: Array<{ text: string; refs: AiAnswerRef[] }>;
  possibleCauses: Array<{ text: string; refs: AiAnswerRef[]; uncertainty: 'possible' }>;
  suggestions: Array<{
    text: string;
    refs: AiAnswerRef[];
    action?: z.infer<typeof aiActionSchema>;
  }>;
  limitations: string[];
}
export function validateAiAnswer(raw: unknown, allowedContexts: AiFactsContext[]): AiAnswer {
  const fail = () => new AiError('protocol', 'AI 回答格式或依据无效', 502);
  let value: unknown;
  try {
    if (Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8') > 32768)
      throw fail();
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw fail();
  }
  const parsed = aiAnswerSchema.safeParse(value);
  if (!parsed.success || !allowedContexts.length) throw fail();
  const contexts = new Map(allowedContexts.map(context => [context.id, context]));
  const currentId = allowedContexts[0].id;
  const result: AiAnswer = parsed.data;
  if (
    allowedContexts[0].facts.some(fact => ['available', 'estimated'].includes(fact.state)) &&
    !result.observations.length
  )
    throw fail();
  for (const observation of result.observations)
    if (!observation.refs.some(reference => reference.contextId === currentId)) throw fail();
  for (const item of [...result.observations, ...result.possibleCauses, ...result.suggestions]) {
    for (const reference of item.refs) {
      const context = contexts.get(reference.contextId);
      if (!context?.facts.some(fact => fact.id === reference.factId)) throw fail();
      if (context.id !== currentId)
        reference.historical = { ...context.currentRange, asOf: context.generatedAt };
    }
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 32768) throw fail();
  return result;
}
export interface AiResolvedAction {
  action: z.infer<typeof aiActionSchema>;
  label: string;
  href: string;
}
export function resolveAiActions(
  answer: AiAnswer,
  context: AiFactsContext,
  locale: LiekanLocale = 'zh-CN',
): AiResolvedAction[] {
  aiUuidSchema.parse(context.website.id);
  const seen = new Set<string>();
  return answer.suggestions.flatMap(suggestion => {
    if (suggestion.action === undefined) return [];
    const action = aiActionSchema.parse(suggestion.action);
    if (seen.has(action)) return [];
    seen.add(action);
    const params =
      action === 'tracking'
        ? { websiteId: context.website.id }
        : {
            websiteId: context.website.id,
            date: `range:${Date.parse(context.currentRange.startAt)}:${Date.parse(context.currentRange.endAt)}`,
            unit: 'day',
            ...(action === 'geo-logs' ? { filter: 'abnormal', live: '0' } : {}),
          };
    return [
      {
        action,
        label: translateText(aiActionLabels[action], locale),
        href: featureHref(action, params),
      },
    ];
  });
}
function localizeGuidance(answer: AiAnswer, locale: LiekanLocale): AiAnswer {
  return {
    ...answer,
    summary: translateText(answer.summary, locale),
    suggestions: answer.suggestions.map(item => ({
      ...item,
      text: translateText(item.text, locale),
    })),
    limitations: answer.limitations.map(value => translateText(value, locale)),
  };
}
export function localAiGreeting(question: string, locale: LiekanLocale = 'zh-CN'): AiAnswer | null {
  // Only a complete greeting bypasses statistics; a greeting with a question uses analysis.
  if (!/^(?:你好|您好|嗨|哈喽|早上好|下午好|晚上好|hi|hello)[\s!！。.?？]*$/i.test(question.trim()))
    return null;
  return localizeGuidance(
    {
      summary: '你好，我是GEOInflow 分析助手。你可以直接提问，我会结合所选网站的数据帮你分析。',
      observations: [],
      possibleCauses: [],
      suggestions: [
        { text: '分析最近 7 天的 AI 抓取趋势', refs: [] },
        { text: '哪些页面值得优先优化？', refs: [] },
        { text: '查看异常请求，给出排查建议', refs: [] },
      ],
      limitations: [],
    },
    locale,
  );
}
export function localAiGuidance(
  context: AiFactsContext,
  reason: 'no_connection' | 'empty' | 'unsupported' | 'local_only',
  locale: LiekanLocale = 'zh-CN',
): AiAnswer {
  const summaries = {
    no_connection: '当前空间尚未配置可用的 AI 连接。',
    local_only: '已读取所选网站的统计依据，当前使用本地接入指引。',
    empty: '所选范围缺少可分析的统计数据。',
    unsupported: '当前统计存储暂不支持 AI 分析。',
  };
  const reference = context.facts.find(fact => fact.id === 'summary') ?? context.facts[0];
  return localizeGuidance(
    {
      summary: summaries[reason],
      observations: [],
      possibleCauses: [],
      suggestions: [
        {
          text: '检查网站统计安装，并确认已接入的数据与统计范围。',
          refs: reference ? [{ contextId: context.id, factId: reference.id }] : [],
          action: 'tracking',
        },
      ],
      limitations: [
        '该提示由本地规则生成，未调用模型。',
        '日志覆盖未经验证；业务背景尚未配置。',
        ...(context.rangeNotes.currentDayIncomplete ? ['当前日期的数据尚未完整。'] : []),
      ],
    },
    locale,
  );
}
