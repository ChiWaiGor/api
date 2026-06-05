import { envSchema } from './env.schema';

export function configuration() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }
  return parsed.data;
}
