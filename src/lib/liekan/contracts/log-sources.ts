import { z } from 'zod';
export const sourceActionSchema = z.strictObject({
  action: z.enum(['pause', 'resume', 'select', 'rotate']),
});
export const healthSchema = z.strictObject({
  version: z.string().max(40),
  pending: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  gap: z.boolean(),
  errorCode: z
    .enum(['none', 'offline', 'buffer-full', 'rotation-gap', 'unreadable', 'format-error'])
    .default('none'),
});
export const pairingSchema = z.strictObject({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const finalizeSchema = z.strictObject({
  flowId: z.uuid(),
  zoneId: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
  acceptCosts: z.boolean().optional(),
});
