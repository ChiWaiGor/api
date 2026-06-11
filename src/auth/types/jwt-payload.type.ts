import type { UserSessionState } from './user-session-state.type';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  jti: string;
  /** Populated by JwtStrategy.validate — not encoded in the JWT itself. */
  sessionState?: UserSessionState;
}

export interface JwtRefreshPayload {
  sub: string;
  tokenId: string;
  jti: string;
}
