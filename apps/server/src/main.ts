import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new NodeAdapter(), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, stopAtFirstError: true }),
  );
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
  app.get(Logger).log(`NestJS server is running at ${await app.getUrl()}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
