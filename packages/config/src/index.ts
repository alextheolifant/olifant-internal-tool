import { z } from 'zod';

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const apiEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CLICKHOUSE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
});

export const webEnvSchema = baseEnvSchema.extend({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
