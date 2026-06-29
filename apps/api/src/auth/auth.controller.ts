import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AllowUnverifiedEmail } from '../common/decorators/allow-unverified-email.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { AUTH_CLIENT_HEADER } from './constants/auth-cookies.constants';
import { CsrfExempt } from './decorators/csrf-exempt.decorator';
import {
  AuthMeResponseDto,
  AuthTokensResponseDto,
  ChangePasswordDto,
  EmailVerificationConfirmDto,
  LoginBodyDto,
  LogoutBodyDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RefreshBodyDto,
  RegisterBodyDto,
  SuccessResponseDto,
} from './auth.schema';
import { isWebAuthClient } from './utils/auth-client.util';

@ApiTags('auth')
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
  @ApiHeader({
    name: AUTH_CLIENT_HEADER,
    required: false,
    description:
      'Set to "web" for httpOnly cookie auth (browser). Omit or use "mobile" for Bearer tokens (native apps).',
  })
  @Post('register')
  async register(
    @Body() body: RegisterBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponseDto> {
    const tokens = await this.authService.register(body);
    return this.deliverTokens(req, res, tokens);
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
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentUser() user: { sub: string },
  ): Promise<SuccessResponseDto> {
    return this.authService.changePassword(user.sub, body);
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
}
