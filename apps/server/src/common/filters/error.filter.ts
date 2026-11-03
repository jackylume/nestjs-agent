import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ApiResponse } from '@nestjs-agent/shared';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    let code = HttpStatus.INTERNAL_SERVER_ERROR;
    let msg = '服务器内部错误';

    if (exception instanceof HttpException) {
      code = exception.getStatus();
      const response = exception.getResponse();
      msg = exception.message;
      if (typeof response === 'string') {
        msg = response;
      } else if ('message' in response) {
        const message: unknown = response.message;
        if (typeof message === 'string') {
          msg = message;
        } else if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
          msg = message[0] ?? msg;
        }
      }
    } else {
      // 请求解析错误可通过 statusCode 携带 HTTP 状态，例如无效 JSON 的 400。
      if (
        exception instanceof Error &&
        'statusCode' in exception &&
        typeof exception.statusCode === 'number' &&
        Number.isInteger(exception.statusCode) &&
        exception.statusCode >= 400 &&
        exception.statusCode <= 599
      ) {
        code = exception.statusCode;
        if (code < 500) msg = exception.message;
      }
      if (code >= 500) this.logger.error(exception);
    }

    const body: ApiResponse<null> = { code, success: false, data: null, msg };
    const { httpAdapter } = this.adapterHost;
    const response = host.switchToHttp().getResponse();
    if (httpAdapter.isHeadersSent(response)) {
      httpAdapter.end(response);
      return;
    }
    httpAdapter.reply(response, body, code);
  }
}
