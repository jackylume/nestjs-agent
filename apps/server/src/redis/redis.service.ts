import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly connection: ReturnType<typeof createClient>;

  constructor() {
    if (!process.env.REDIS_URL) {
      throw new Error('缺少 REDIS_URL，请将根目录 .env.example 复制为 .env 并配置 Redis。');
    }

    this.connection = createClient({
      url: process.env.REDIS_URL,
      socket: { connectTimeout: 3000 },
      disableOfflineQueue: true,
      commandOptions: { timeout: 3000 },
    });
    this.connection.on('error', () => this.logger.error('Redis 连接错误'));
  }

  get client(): ReturnType<typeof createClient> {
    if (!this.connection.isReady) throw new ServiceUnavailableException('Redis 暂不可用');
    return this.connection;
  }

  onModuleInit(): void {
    // 客户端在后台自动重连，Redis 暂不可达不阻塞 API 启动。
    void this.connection.connect().catch(() => undefined);
  }

  async checkConnection(): Promise<void> {
    await this.run((client) => client.ping());
  }

  async run<T>(operation: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(this.client),
        new Promise<never>((_, reject) => {
          // 客户端的命令超时仅约束排队时间，这里同时限制响应等待时间。
          timeout = setTimeout(() => reject(new Error('Redis 请求超时')), 3000);
          timeout.unref();
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException('Redis 暂不可用');
    } finally {
      clearTimeout(timeout);
    }
  }

  onApplicationShutdown(): void {
    if (this.connection.isOpen) this.connection.destroy();
  }
}
