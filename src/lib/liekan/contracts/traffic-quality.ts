import { z } from 'zod';

export const trafficPolicySchema = z.strictObject({
  mode: z.enum(['standard', 'strict', 'raw']),
  allowedHostnames: z.array(z.string().trim().min(1).max(253)).max(100),
});
export type TrafficPolicy = z.infer<typeof trafficPolicySchema>;
