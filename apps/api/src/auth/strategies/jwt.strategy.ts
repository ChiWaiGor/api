import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Env } from '@app/shared';
import { AuthService } from '../auth.service';
import { extractAccessToken } from '../utils/jwt-cookie-extractor';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (await this.authService.isAccessTokenBlacklisted(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const sessionState = await this.authService.getUserSessionState(
      payload.sub,
    );
    this.authService.assertActiveSession(sessionState);

    return { ...payload, sessionState };
  }
}
