import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_VERIFIED_EMAIL } from '../decorators/require-verified-email.decorator';

@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_EMAIL,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) {
      return false;
    }

    const record = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { emailVerifiedAt: true, deletedAt: true },
    });

    if (!record || record.deletedAt || !record.emailVerifiedAt) {
      throw new ForbiddenException('Email verification required');
    }

    return true;
  }
}
