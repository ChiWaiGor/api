import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { RbacService } from '../../rbac/rbac.service';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
  PermissionsMode,
} from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }

    const mode =
      this.reflector.getAllAndOverride<PermissionsMode>(PERMISSIONS_MODE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'all';

    const request = context.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const permissions = await this.rbac.getUserPermissions(user.sub);
    const allowed =
      mode === 'any'
        ? required.some((p) => permissions.includes(p))
        : required.every((p) => permissions.includes(p));

    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
