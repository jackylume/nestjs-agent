import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vite-plus/test';
import { LoginDto } from '../../../src/auth/dto/login.dto.js';

const pipe = new ValidationPipe({ transform: true, whitelist: true, stopAtFirstError: true });

function validateBody(body: unknown): Promise<LoginDto> {
  return pipe.transform(body, { type: 'body', metatype: LoginDto });
}

describe('LoginDto', () => {
  it('继承账号校验与转换，清理用户名、保留密码空格并剔除额外字段', async () => {
    const dto = await validateBody({
      username: '  jacky  ',
      password: ' pass word ',
      token: 'supplied-token',
      passwordHash: 'supplied-hash',
    });

    expect(dto).toBeInstanceOf(LoginDto);
    expect(dto).toEqual({ username: 'jacky', password: ' pass word ' });
  });

  it.each([
    undefined,
    null,
    {},
    { username: 'jacky' },
    { username: 'ab', password: 'password' },
    { username: 123, password: 'password' },
    { username: 'jacky', password: 12345678 },
    { username: 'jacky', password: '      ' },
    { username: 'jacky', password: 'abcdef\n' },
    { username: 'jacky', password: 'a'.repeat(17) },
  ])('无效登录参数返回 400：%j', async (body) => {
    await expect(validateBody(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
