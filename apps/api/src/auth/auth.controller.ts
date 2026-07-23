import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AllowUnverifiedEmail } from '../common/decorators/allow-unverified-email.decorator';
import { ApiErrorResponses } from '../common/decorators/api-error-responses.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { AUTH_CLIENT_HEADER } from './constants/auth-cookies.constants';
import { CsrfExempt } from './decorators/csrf-exempt.decorator';
import {
  AuthMeResponseDto,
  AuthSessionParamsDto,
  AuthSessionsResponseDto,
  AuthTokensResponseDto,
  ChangePasswordDto,
  EmailVerificationConfirmDto,
  ListSessionsQueryDto,
  LoginBodyDto,
  LogoutBodyDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RefreshBodyDto,
  RegisterBodyDto,
  RevokeAllSessionsBodyDto,
  RevokeAllSessionsResponseDto,
  SuccessResponseDto,
} from './auth.schema';
import { isWebAuthClient } from './utils/auth-client.util';

@ApiTags('auth')
@ApiErrorResponses()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookies: AuthCookieService,
  ) {}

  @Public()
  @CsrfExempt()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.OK)
  @Post('register')
  register(@Body() body: RegisterBodyDto): Promise<SuccessResponseDto> {
    // Uniform response regardless of whether the email is already registered
    // (prevents enumeration). Verify the email, then log in for tokens.
    return this.authService.register(body);
  }

  @Public()
  @CsrfExempt()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @ApiHeader({
    name: AUTH_CLIENT_HEADER,
    required: false,
    description:
      'Set to "web" for httpOnly cookie auth (browser). Omit or use "mobile" for Bearer tokens (native apps).',
  })
  @Post('login')
  async login(
    @Body() body: LoginBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponseDto> {
    const tokens = await this.authService.login(body);
    return this.deliverTokens(req, res, tokens);
  }

  @Public()
  @SkipThrottle({ default: true })
  @Throttle({ 'auth-refresh': {} })
  @ApiHeader({
    name: AUTH_CLIENT_HEADER,
    required: false,
    description:
      'Set to "web" for httpOnly cookie auth (browser). Omit or use "mobile" for Bearer tokens (native apps).',
  })
  @Post('refresh')
  async refresh(
    @Body() body: RefreshBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponseDto> {
    const refreshToken = this.resolveRefreshToken(req, body);
    const tokens = await this.authService.refresh({ refreshToken });
    return this.deliverTokens(req, res, tokens);
  }

  @AllowUnverifiedEmail()
  @ApiBearerAuth()
  @Post('logout')
  async logout(
    @Body() body: LogoutBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: { sub: string; jti: string },
  ): Promise<{ success: boolean }> {
    const refreshToken = this.resolveRefreshToken(req, body, false);
    const result = await this.authService.logout({ refreshToken }, user.jti);
    if (isWebAuthClient(req) || this.authCookies.hasAuthCookies(req)) {
      this.authCookies.clearAuthCookies(res);
    }
    return result;
  }

  @Public()
  @CsrfExempt()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/request')
  requestPasswordReset(
    @Body() body: PasswordResetRequestDto,
  ): Promise<SuccessResponseDto> {
    return this.authService.requestPasswordReset(body);
  }

  @Public()
  @CsrfExempt()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  confirmPasswordReset(
    @Body() body: PasswordResetConfirmDto,
  ): Promise<SuccessResponseDto> {
    return this.authService.confirmPasswordReset(body);
  }

  @AllowUnverifiedEmail()
  @ApiBearerAuth()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.OK)
  @Post('email-verification/request')
  requestEmailVerification(
    @CurrentUser() user: { sub: string },
  ): Promise<SuccessResponseDto> {
    return this.authService.requestEmailVerification(user.sub);
  }

  @Public()
  @CsrfExempt()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.OK)
  @Post('email-verification/confirm')
  confirmEmailVerification(
    @Body() body: EmailVerificationConfirmDto,
  ): Promise<SuccessResponseDto> {
    return this.authService.confirmEmailVerification(body);
  }

  @AllowUnverifiedEmail()
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: { sub: string }): Promise<AuthMeResponseDto> {
    return this.authService.getMe(user.sub);
  }

  @ApiBearerAuth()
  @Get('sessions')
  listSessions(
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
    @Query() query: ListSessionsQueryDto,
  ): Promise<AuthSessionsResponseDto> {
    const refreshToken = this.getOptionalRefreshToken(req, query.refreshToken);
    return this.authService.listSessions(user.sub, refreshToken);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Post('sessions/revoke-all')
  async revokeAllSessions(
    @Body() body: RevokeAllSessionsBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: { sub: string; jti: string },
  ): Promise<RevokeAllSessionsResponseDto> {
    const refreshToken = this.getOptionalRefreshToken(req, body.refreshToken);
    const result = await this.authService.revokeAllSessions(user.sub, {
      exceptCurrent: body.exceptCurrent,
      currentRefreshToken: refreshToken,
      accessJti: body.exceptCurrent ? undefined : user.jti,
    });

    if (
      !body.exceptCurrent &&
      (isWebAuthClient(req) || this.authCookies.hasAuthCookies(req))
    ) {
      this.authCookies.clearAuthCookies(res);
    }

    return result;
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Delete('sessions/:sessionId')
  async revokeSession(
    @Param() params: AuthSessionParamsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: { sub: string; jti: string },
  ): Promise<SuccessResponseDto> {
    const refreshToken = this.getOptionalRefreshToken(req);
    const result = await this.authService.revokeSession(
      user.sub,
      params.sessionId,
      {
        accessJti: user.jti,
        currentRefreshToken: refreshToken,
      },
    );

    const currentFamilyId = await this.authService.resolveSessionFamilyId(
      user.sub,
      refreshToken,
    );
    if (
      currentFamilyId === params.sessionId &&
      (isWebAuthClient(req) || this.authCookies.hasAuthCookies(req))
    ) {
      this.authCookies.clearAuthCookies(res);
    }

    return result;
  }

  @ApiBearerAuth()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: { sub: string; jti: string },
  ): Promise<SuccessResponseDto> {
    const result = await this.authService.changePassword(
      user.sub,
      body,
      user.jti,
    );
    // All tokens (including the current access token) are revoked; drop the
    // now-dead cookies so web clients are cleanly signed out.
    if (isWebAuthClient(req) || this.authCookies.hasAuthCookies(req)) {
      this.authCookies.clearAuthCookies(res);
    }
    return result;
  }

  private deliverTokens(
    req: Request,
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ): AuthTokensResponseDto {
    if (isWebAuthClient(req)) {
      this.authCookies.setAuthCookies(res, tokens);
      return {};
    }
    return tokens;
  }

  private resolveRefreshToken(
    req: Request,
    body: RefreshBodyDto | LogoutBodyDto,
    required = true,
  ): string {
    const refreshToken =
      body.refreshToken ?? this.authCookies.getRefreshToken(req);
    if (required && !refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }
    return refreshToken ?? '';
  }

  private getOptionalRefreshToken(
    req: Request,
    refreshTokenQuery?: string,
  ): string | undefined {
    const refreshToken =
      refreshTokenQuery ?? this.authCookies.getRefreshToken(req);
    return refreshToken && refreshToken.length > 0 ? refreshToken : undefined;
  }
}
