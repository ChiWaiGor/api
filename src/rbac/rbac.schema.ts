import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { cuidSchema } from '../common/schemas/primitives.schema';

export const roleParamsSchema = z.object({
  id: cuidSchema,
});

export const permissionParamsSchema = z.object({
  id: cuidSchema,
});

export const createRoleBodySchema = z.object({
  name: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z][a-z0-9_-]*$/, 'Role name must be lowercase alphanumeric'),
  description: z.string().max(255).optional(),
});

export const updateRoleBodySchema = z.object({
  name: createRoleBodySchema.shape.name.optional(),
  description: z.string().max(255).optional(),
});

export const assignRoleBodySchema = z.object({
  userId: cuidSchema,
  roleId: cuidSchema,
});

export const attachPermissionBodySchema = z.object({
  roleId: cuidSchema,
  permissionId: cuidSchema,
});

export const roleResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()).optional(),
});

export const permissionResponseSchema = z.object({
  id: z.string(),
  action: z.string(),
  description: z.string().nullable(),
});

export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;
export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>;
export type AssignRoleBody = z.infer<typeof assignRoleBodySchema>;
export type AttachPermissionBody = z.infer<typeof attachPermissionBodySchema>;

export class RoleParamsDto extends createZodDto(roleParamsSchema) {}
export class PermissionParamsDto extends createZodDto(permissionParamsSchema) {}
export class CreateRoleBodyDto extends createZodDto(createRoleBodySchema) {}
export class UpdateRoleBodyDto extends createZodDto(updateRoleBodySchema) {}
export class AssignRoleBodyDto extends createZodDto(assignRoleBodySchema) {}
export class AttachPermissionBodyDto extends createZodDto(attachPermissionBodySchema) {}
export class RoleResponseDto extends createZodDto(roleResponseSchema) {}
export class PermissionResponseDto extends createZodDto(permissionResponseSchema) {}
