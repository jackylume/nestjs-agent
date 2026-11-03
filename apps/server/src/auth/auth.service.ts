import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LoginResponse, RegisterResponse, UserResponse } from '@nestjs-agent/shared';
import { accessTokenLifetimeSeconds, refreshTokenLifetimeMs } from '../config/auth.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import { hashPassword, verifyPassword } from './password.util.js';
import { SessionService } from './session.service.js';

const sessionIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const refreshTokenPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{64}$/;
// 未注册的用户名也执行一次密码推导，避免通过明显的耗时差异探测账号。
const dummyPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
  ) {}

  async register({ username, password }: RegisterDto): Promise<RegisterResponse> {
    const passwordHash = await hashPassword(password);

    try {
      const user = await this.database.user.create({
        data: { username, passwordHash },
        select: { id: true, username: true },
      });
      return { id: user.id, username: user.username };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('用户名已存在');
      }
      throw error;
    }
  }

  async login({ username, password }: LoginDto): Promise<LoginResponse> {
    const user = await this.database.user.findUnique({
      where: { username },
      select: { id: true, passwordHash: true, authVersion: true },
    });
    const validPassword = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
    if (!user || !validPassword) throw new UnauthorizedException('用户名或密码错误');

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + refreshTokenLifetimeMs);
    const tokens = await this.issueTokens(user.id, id, expiresAt);
    await this.sessions.create(id, {
      userId: user.id,
      // 绑定验证密码时的版本，改密期间建立的旧版本会话也无法通过鉴权。
      authVersion: user.authVersion,
      refreshTokenHash: hashToken(tokens.refreshToken),
      expiresAt: expiresAt.getTime(),
    });
    return tokens;
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    if (!refreshTokenPattern.test(refreshToken)) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    const id = refreshToken.split('.')[0]!;
    const refreshTokenHash = hashToken(refreshToken);
    const session = await this.sessions.find(id);
    if (
      !session ||
      session.expiresAt <= Date.now() ||
      session.refreshTokenHash.length !== refreshTokenHash.length ||
      !timingSafeEqual(Buffer.from(session.refreshTokenHash), Buffer.from(refreshTokenHash))
    ) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    const user = await this.database.user.findUnique({
      where: { id: session.userId },
      select: { authVersion: true },
    });
    if (!user || user.authVersion !== session.authVersion) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    const tokens = await this.issueTokens(session.userId, id, new Date(session.expiresAt));
    // 比较并更新确保同一个 Refresh Token 并发使用时只有一个请求能成功。
    const rotated = await this.sessions.rotate(
      id,
      refreshTokenHash,
      hashToken(tokens.refreshToken),
    );
    if (!rotated) throw new UnauthorizedException('登录已失效，请重新登录');
    return tokens;
  }

  async validateAccessToken(claims: unknown): Promise<UserResponse> {
    if (
      !claims ||
      typeof claims !== 'object' ||
      !('type' in claims) ||
      claims.type !== 'access' ||
      !('sub' in claims) ||
      typeof claims.sub !== 'string' ||
      !/^[1-9]\d*$/.test(claims.sub) ||
      !Number.isSafeInteger(Number(claims.sub)) ||
      !('sid' in claims) ||
      typeof claims.sid !== 'string' ||
      !sessionIdPattern.test(claims.sid) ||
      !('exp' in claims) ||
      typeof claims.exp !== 'number' ||
      !Number.isInteger(claims.exp)
    ) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    const session = await this.sessions.find(claims.sid);
    if (!session || session.expiresAt <= Date.now() || String(session.userId) !== claims.sub) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    const user = await this.database.user.findUnique({
      where: { id: session.userId },
      select: { id: true, username: true, authVersion: true },
    });
    if (!user || user.authVersion !== session.authVersion) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    return { id: user.id, username: user.username };
  }

  async logout(sessionId: string): Promise<null> {
    if (!sessionIdPattern.test(sessionId)) return null;
    await this.sessions.delete(sessionId);
    return null;
  }

  private async issueTokens(
    userId: number,
    sessionId: string,
    refreshTokenExpiresAt: Date,
  ): Promise<LoginResponse> {
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(
      now + accessTokenLifetimeSeconds,
      Math.floor(refreshTokenExpiresAt.getTime() / 1000),
    );
    if (exp <= now) throw new UnauthorizedException('登录已失效，请重新登录');
    const accessToken = await this.jwt.signAsync({
      sub: String(userId),
      sid: sessionId,
      type: 'access',
      jti: randomUUID(),
      iat: now,
      exp,
    });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(exp * 1000).toISOString(),
      refreshToken: `${sessionId}.${randomBytes(32).toString('hex')}`,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }

  async changePassword(
    userId: number,
    { oldPassword, newPassword }: ChangePasswordDto,
  ): Promise<null> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('登录已失效，请重新登录');
    if (!(await verifyPassword(oldPassword, user.passwordHash))) {
      throw new BadRequestException('旧密码不正确');
    }
    const passwordHash = await hashPassword(newPassword);
    // 同一条更新同时改密和撤销旧版本会话，不依赖 PostgreSQL 与 Redis 跨库事务。
    const result = await this.database.user.updateMany({
      where: { id: userId, passwordHash: user.passwordHash },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException('密码已变更，请重新操作');
    return null;
  }
}
