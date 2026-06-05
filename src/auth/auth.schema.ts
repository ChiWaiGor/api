import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
} from '../common/schemas/primitives.schema';

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const authTokensResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const authMeResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type LogoutBody = z.infer<typeof logoutBodySchema>;

export class RegisterBodyDto extends createZodDto(registerBodySchema) {}
export class LoginBodyDto extends createZodDto(loginBodySchema) {}
export class RefreshBodyDto extends createZodDto(refreshBodySchema) {}
export class LogoutBodyDto extends createZodDto(logoutBodySchema) {}
export class AuthTokensResponseDto extends createZodDto(
  authTokensResponseSchema,
) {}
export class AuthMeResponseDto extends createZodDto(authMeResponseSchema) {}
