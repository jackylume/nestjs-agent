import { HttpStatus, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ApiResponse } from '@nestjs-agent/shared';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

@Injectable()
export class SuccessInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        this.adapterHost.httpAdapter.status(context.switchToHttp().getResponse(), HttpStatus.OK);
        return {
          code: HttpStatus.OK,
          success: true,
          data: data ?? null,
          msg: '请求成功',
        };
      }),
    );
  }
}
