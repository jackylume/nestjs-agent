import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { ErrorFilter } from './common/filters/error.filter.js';
import { GlobalGuard } from './common/guards/global.guard.js';
import { SuccessInterceptor } from './common/interceptors/success.interceptor.js';
import { loggerOptions } from './config/logger.js';
import { HealthModule } from './health/health.module.js';
import { UserModule } from './user/user.module.js';

@Module({
  imports: [LoggerModule.forRoot(loggerOptions), AuthModule, HealthModule, UserModule],
  providers: [
    { provide: APP_GUARD, useClass: GlobalGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
