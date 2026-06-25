import { z } from 'zod';

/** Request DTOs: reject unknown keys on body, query, and route params. */
export const requestObject = z.strictObject;

export const cuidSchema = z.string().cuid();

export const emailSchema = z
  .string()
  .email('Invalid email address')
  .transform((v) => v.toLowerCase().trim());

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const paginationQuerySchema = requestObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
