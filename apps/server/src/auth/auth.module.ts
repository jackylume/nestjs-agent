import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { jwtOptions } from '../config/auth.js';
import { DatabaseModule } from '../database/database.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    PassportModule,
    JwtModule.registerAsync({ useFactory: jwtOptions }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SessionService],
  exports: [AuthService],
})
export class AuthModule {}
