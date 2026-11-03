import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { AuthRequest } from '../../auth/auth-request.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

@Injectable()
export class GlobalGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();
    // 保持严格的请求头格式，避免 Passport 提取器忽略 Token 后的多余内容。
    if (
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(
        request.headers.authorization ?? '',
      )
    ) {
      throw new UnauthorizedException('请先登录');
    }

    return super.canActivate(context);
  }

  handleRequest<TUser>(error: unknown, user: TUser | false | null): TUser {
    if (error) throw error;
    if (!user) throw new UnauthorizedException('登录已失效，请重新登录');
    return user;
  }
}
