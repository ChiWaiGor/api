export const redisKeys = {
  accessBlacklist: (jti: string) => `blacklist:access:${jti}`,
  permissionCache: (userId: string) => `cache:permissions:${userId}`,
  userSessionState: (userId: string) => `cache:user-session:${userId}`,
  failedLogins: (email: string) => `auth:failed-logins:${email}`,
} as const;
