import type { JwtModuleOptions } from '@nestjs/jwt';

export const accessTokenLifetimeSeconds = 2 * 60 * 60;
export const refreshTokenLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export function jwtOptions() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('JWT_SECRET 必须设置为至少 32 字节的随机密钥。');
  }
  return {
    secret,
    signOptions: {
      algorithm: 'HS256',
      issuer: 'nestjs-agent',
      audience: 'nestjs-agent-web',
    },
    verifyOptions: {
      algorithms: ['HS256'],
      issuer: 'nestjs-agent',
      audience: 'nestjs-agent-web',
    },
  } satisfies JwtModuleOptions;
}
