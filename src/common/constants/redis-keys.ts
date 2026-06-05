export const redisKeys = {
  accessBlacklist: (jti: string) => `blacklist:access:${jti}`,
  permissionCache: (userId: string) => `cache:permissions:${userId}`,
} as const;
