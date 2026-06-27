import { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import type { ZodIssue } from 'zod';

export const API_ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export type ApiErrorDetail = {
  path?: string;
  code?: string;
  message: string;
};

export type ApiErrorBody = {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[];
  requestId?: string;
  timestamp: string;
  path: string;
};

const OPERATIONAL_PATH_PREFIXES = ['/health', '/metrics'];

const STATUS_TO_ERROR_CODE: Record<number, ApiErrorCode> = {
  [HttpStatus.BAD_REQUEST]: API_ERROR_CODES.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: API_ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: API_ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: API_ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: API_ERROR_CODES.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: API_ERROR_CODES.TOO_MANY_REQUESTS,
  [HttpStatus.SERVICE_UNAVAILABLE]: API_ERROR_CODES.SERVICE_UNAVAILABLE,
};

export function isOperationalExemptPath(path: string): boolean {
  const pathname = path.split('?')[0] ?? path;
  return OPERATIONAL_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function getRequestPath(request: Request): string {
  return request.url?.split('?')[0] ?? '/';
}

export function getRequestId(request: Request): string | undefined {
  const header = request.headers?.['x-request-id'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  const id = (request as { id?: unknown }).id;
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  if (typeof id === 'number') {
    return String(id);
  }
  return undefined;
}

export function statusToErrorCode(statusCode: number): ApiErrorCode {
  const mapped = STATUS_TO_ERROR_CODE[statusCode];
  if (mapped) {
    return mapped;
  }
  return statusCode >= 500
    ? API_ERROR_CODES.INTERNAL_ERROR
    : API_ERROR_CODES.BAD_REQUEST;
}

export function buildApiErrorBody(options: {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  path: string;
  details?: ApiErrorDetail[];
  requestId?: string;
}): ApiErrorBody {
  return {
    statusCode: options.statusCode,
    code: options.code,
    message: options.message,
    ...(options.details?.length ? { details: options.details } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    timestamp: new Date().toISOString(),
    path: options.path,
  };
}

export function parseHttpExceptionResponse(
  exceptionResponse: string | object,
): { message: string; details?: ApiErrorDetail[] } {
  if (typeof exceptionResponse === 'string') {
    return { message: exceptionResponse };
  }

  const { message: rawMessage } = exceptionResponse as {
    message?: string | string[];
  };

  if (Array.isArray(rawMessage)) {
    return {
      message: 'Validation failed',
      details: rawMessage.map((entry) => ({ message: entry })),
    };
  }

  if (typeof rawMessage === 'string') {
    return { message: rawMessage };
  }

  return { message: 'Error' };
}

export function mapZodIssuesToDetails(issues: ZodIssue[]): ApiErrorDetail[] {
  return issues.map((issue) => ({
    ...(issue.path.length > 0 ? { path: issue.path.join('.') } : {}),
    code: issue.code,
    message: issue.message,
  }));
}
