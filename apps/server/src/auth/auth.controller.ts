import { Body, Controller, Post, Req } from '@nestjs/common';
import type { LoginResponse, RegisterResponse } from '@nestjs-agent/shared';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthRequest } from './auth-request.js';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  register(@Body() dto: RegisterDto): Promise<RegisterResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Public()
  refresh(@Body() dto: RefreshTokenDto): Promise<LoginResponse> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Req() request: AuthRequest): Promise<null> {
    return this.authService.logout(request.user.sessionId);
  }

  @Post('change-password')
  changePassword(@Req() request: AuthRequest, @Body() dto: ChangePasswordDto): Promise<null> {
    return this.authService.changePassword(request.user.id, dto);
  }
}
