import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { jwtOptions } from '../../src/config/auth.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('JWT 配置', () => {
  it.each([undefined, '', 'short-secret'])('缺少或过短的密钥使配置失败', (secret) => {
    vi.stubEnv('JWT_SECRET', secret);
    expect(() => jwtOptions()).toThrow('JWT_SECRET 必须设置为至少 32 字节的随机密钥。');
  });

  it('使用配置的密钥签名，只接受指定算法、签发者与接收者', async () => {
    const secret = randomBytes(32).toString('hex');
    vi.stubEnv('JWT_SECRET', secret);
    const jwt = new JwtService(jwtOptions());
    const token = await jwt.signAsync({ sub: '1' }, { expiresIn: 60 });
    await expect(jwt.verifyAsync(token)).resolves.toMatchObject({
      sub: '1',
      iss: 'nestjs-agent',
      aud: 'nestjs-agent-web',
    });

    const signer = new JwtService({ secret });
    for (const claims of [
      { iss: 'other-service', aud: 'nestjs-agent-web' },
      { iss: 'nestjs-agent', aud: 'other-app' },
    ]) {
      const invalid = await signer.signAsync(claims, { algorithm: 'HS256', expiresIn: 60 });
      await expect(jwt.verifyAsync(invalid)).rejects.toBeInstanceOf(Error);
    }
    const invalidAlgorithm = await jwt.signAsync(
      { sub: '1' },
      { algorithm: 'HS384', expiresIn: 60 },
    );
    await expect(jwt.verifyAsync(invalidAlgorithm)).rejects.toBeInstanceOf(Error);
  });
});
