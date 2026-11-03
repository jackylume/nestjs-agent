import { Controller, Get, Req } from '@nestjs/common';
import type { UserResponse } from '@nestjs-agent/shared';
import type { AuthRequest } from '../auth/auth-request.js';

@Controller('user')
export class UserController {
  @Get('info')
  info(@Req() request: AuthRequest): UserResponse {
    const { id, username } = request.user;
    return { id, username };
  }
}
