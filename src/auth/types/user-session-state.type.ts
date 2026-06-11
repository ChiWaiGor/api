import { UserStatus } from '@prisma/client';

/** Serializable session snapshot cached in Redis and attached to `request.user`. */
export type UserSessionState = {
  status: UserStatus;
  emailVerifiedAt: string | null;
  deletedAt: string | null;
};

export function toUserSessionState(row: {
  status: UserStatus;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
}): UserSessionState {
  return {
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export function isEmailVerified(state: UserSessionState): boolean {
  return state.emailVerifiedAt !== null;
}
