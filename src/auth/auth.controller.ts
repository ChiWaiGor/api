import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import {
  AuthMeResponseDto,
  AuthTokensResponseDto,
  LoginBodyDto,
  LogoutBodyDto,
  RefreshBodyDto,
  RegisterBodyDto,
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

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  logout(
    @Body() body: LogoutBodyDto,
    @CurrentUser() user: { sub: string; jti: string },
  ): Promise<{ success: boolean }> {
    return this.authService.logout(body, user.jti);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: { sub: string }): Promise<AuthMeResponseDto> {
    return this.authService.getMe(user.sub);
  }
}
