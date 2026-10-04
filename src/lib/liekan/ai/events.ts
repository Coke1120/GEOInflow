import { z } from 'zod';
export const aiEventNameSchema = z.enum(['started', 'stage', 'delta', 'answer', 'done', 'error']);
export type AiEventName = z.infer<typeof aiEventNameSchema>;
export interface AiEvent {
  protocolVersion: 1;
  runId: string;
  sequence: number;
  type: AiEventName;
  data: unknown;
}
