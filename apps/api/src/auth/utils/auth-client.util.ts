import type { Request } from 'express';
import {
  AUTH_CLIENT_HEADER,
  type AuthClient,
} from '../constants/auth-cookies.constants';

export function getAuthClient(req: Request): AuthClient {
  const header = req.headers[AUTH_CLIENT_HEADER];
  if (typeof header === 'string' && header.toLowerCase() === 'web') {
    return 'web';
  }
  return 'mobile';
}

export function isWebAuthClient(req: Request): boolean {
  return getAuthClient(req) === 'web';
}
