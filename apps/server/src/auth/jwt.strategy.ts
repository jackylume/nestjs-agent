import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtOptions } from '../config/auth.js';
import type { AuthenticatedUser } from './auth-request.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    const options = jwtOptions();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: options.secret,
      ...options.verifyOptions,
      ignoreExpiration: false,
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedUser> {
    const user = await this.authService.validateAccessToken(payload);
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('sid' in payload) ||
      typeof payload.sid !== 'string'
    ) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    return { ...user, sessionId: payload.sid };
  }
}
