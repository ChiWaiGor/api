import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  cuidSchema,
  emailSchema,
  paginationQuerySchema,
  passwordSchema,
} from '../common/schemas/primitives.schema';

export const userParamsSchema = z.object({
  id: cuidSchema,
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
});

export const createUserBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  roleNames: z.array(z.string().min(1)).optional(),
});

export const updateUserBodySchema = z.object({
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
});

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']),
  roles: z.array(z.string()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const paginatedUsersResponseSchema = z.object({
  data: z.array(userResponseSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  }),
});

export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export class UserParamsDto extends createZodDto(userParamsSchema) {}
export class ListUsersQueryDto extends createZodDto(listUsersQuerySchema) {}
export class CreateUserBodyDto extends createZodDto(createUserBodySchema) {}
export class UpdateUserBodyDto extends createZodDto(updateUserBodySchema) {}
export class UserResponseDto extends createZodDto(userResponseSchema) {}
export class PaginatedUsersResponseDto extends createZodDto(
  paginatedUsersResponseSchema,
) {}
