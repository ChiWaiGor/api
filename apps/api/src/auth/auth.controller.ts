import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AllowUnverifiedEmail } from '../common/decorators/allow-unverified-email.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @Post('register')
  register(@Body() body: RegisterBodyDto): Promise<AuthTokensResponseDto> {
    return this.authService.register(body);
  }

  @Public()
  @SkipThrottle({ default: true })
  @Throttle({ auth: {} })
  @Post('login')
  login(@Body() body: LoginBodyDto): Promise<AuthTokensResponseDto> {
    return this.authService.login(body);
  }

  @Public()
  @SkipThrottle({ default: true })
  @Throttle({ 'auth-refresh': {} })
  @Post('refresh')
  refresh(@Body() body: RefreshBodyDto): Promise<AuthTokensResponseDto> {
    return this.authService.refresh(body);
  }

  @AllowUnverifiedEmail()
  @ApiBearerAuth()
  @Post('logout')
  logout(
    @Body() body: LogoutBodyDto,
    @CurrentUser() user: { sub: string; jti: string },
  ): Promise<{ success: boolean }> {
    return this.authService.logout(body, user.jti);
  }

  @Public()
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
}
