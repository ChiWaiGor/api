export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  jti: string;
}

export interface JwtRefreshPayload {
  sub: string;
  tokenId: string;
  jti: string;
}
