import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  requestObject,
} from '../common/schemas/primitives.schema';

export const registerBodySchema = requestObject({
  email: emailSchema,
  password: passwordSchema,
});

export const loginBodySchema = requestObject({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const refreshBodyDtoSchema = requestObject({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

export const logoutBodyDtoSchema = requestObject({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

export const passwordResetRequestSchema = requestObject({
  email: emailSchema,
});

export const passwordResetConfirmSchema = requestObject({
  token: z.string().min(1, 'Token is required'),
  newPassword: passwordSchema,
});

export const changePasswordSchema = requestObject({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const emailVerificationConfirmSchema = requestObject({
  token: z.string().min(1, 'Token is required'),
});

export const successResponseSchema = z.object({
  success: z.boolean(),
});

export const authTokensResponseSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
});

export const authMeResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']),
  emailVerified: z.boolean(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = { refreshToken: string };
export type LogoutBody = { refreshToken: string };
export type PasswordResetRequestBody = z.infer<
  typeof passwordResetRequestSchema
>;
export type PasswordResetConfirmBody = z.infer<
  typeof passwordResetConfirmSchema
>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
export type EmailVerificationConfirmBody = z.infer<
  typeof emailVerificationConfirmSchema
>;

export class RegisterBodyDto extends createZodDto(registerBodySchema) {}
export class LoginBodyDto extends createZodDto(loginBodySchema) {}
export class RefreshBodyDto extends createZodDto(refreshBodyDtoSchema) {}
export class LogoutBodyDto extends createZodDto(logoutBodyDtoSchema) {}
export class PasswordResetRequestDto extends createZodDto(
  passwordResetRequestSchema,
) {}
export class PasswordResetConfirmDto extends createZodDto(
  passwordResetConfirmSchema,
) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class EmailVerificationConfirmDto extends createZodDto(
  emailVerificationConfirmSchema,
) {}
export class AuthTokensResponseDto extends createZodDto(
  authTokensResponseSchema,
) {}
export class AuthMeResponseDto extends createZodDto(authMeResponseSchema) {}
export class SuccessResponseDto extends createZodDto(successResponseSchema) {}
