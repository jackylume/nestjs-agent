import type { Params } from 'nestjs-pino';
import type { StdSerializedResults } from 'pino-http';

export const loggerOptions = {
  pinoHttp: {
    customLogLevel(_request, response, error) {
      if (error || response.statusCode >= 500) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req(request: StdSerializedResults['req']) {
        return {
          id: request.id,
          method: request.method,
          url: request.url.split('?')[0],
        };
      },
      res(response: StdSerializedResults['res']) {
        return { statusCode: response.statusCode };
      },
    },
  },
} satisfies Params;
