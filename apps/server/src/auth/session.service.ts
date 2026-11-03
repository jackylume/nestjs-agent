import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

export interface RedisSession {
  userId: number;
  authVersion: number;
  refreshTokenHash: string;
  expiresAt: number;
}

const rotateSessionScript = `
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local session = cjson.decode(value)
if session.refreshTokenHash ~= ARGV[1] then return 0 end
session.refreshTokenHash = ARGV[2]
local updated = redis.call('SET', KEYS[1], cjson.encode(session), 'XX', 'KEEPTTL')
if not updated then return 0 end
return 1
`;

@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  async create(id: string, session: RedisSession): Promise<void> {
    if (session.expiresAt <= Date.now()) throw new Error('不能创建已到期的登录会话');
    const result = await this.redis.run((client) =>
      client.set(`nestjs-agent:session:${id}`, JSON.stringify(session), {
        condition: 'NX',
        expiration: { type: 'PXAT', value: session.expiresAt },
      }),
    );
    if (result !== 'OK') throw new Error('登录会话已存在');
  }

  async find(id: string): Promise<RedisSession | null> {
    const value = await this.redis.run((client) => client.get(`nestjs-agent:session:${id}`));
    return value === null ? null : (JSON.parse(value) as RedisSession);
  }

  async rotate(id: string, expectedHash: string, newHash: string): Promise<boolean> {
    const result = await this.redis.run((client) =>
      client.eval(rotateSessionScript, {
        keys: [`nestjs-agent:session:${id}`],
        arguments: [expectedHash, newHash],
      }),
    );
    return result === 1;
  }

  async delete(id: string): Promise<void> {
    await this.redis.run((client) => client.del(`nestjs-agent:session:${id}`));
  }
}
