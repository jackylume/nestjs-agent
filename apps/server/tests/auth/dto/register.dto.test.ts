import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vite-plus/test';
import { AuthController } from '../../../src/auth/auth.controller.js';
import { RegisterDto } from '../../../src/auth/dto/register.dto.js';

const pipe = new ValidationPipe({ transform: true, whitelist: true, stopAtFirstError: true });

function validateBody(body: unknown): Promise<RegisterDto> {
  return pipe.transform(body, { type: 'body', metatype: RegisterDto });
}

describe('RegisterDto', () => {
  it.each([
    { name: '未提供请求体', body: undefined },
    { name: 'null', body: null },
    { name: '字符串', body: 'jacky' },
    { name: '数字', body: 1 },
    { name: '布尔值', body: true },
    { name: '空数组', body: [] },
    { name: '包含有效对象的数组', body: [{ username: 'jacky', password: 'password' }] },
    { name: '空对象', body: {} },
    { name: '非字符串用户名', body: { username: 123, password: 'password' } },
    { name: '数组用户名', body: { username: ['jacky'], password: 'password' } },
    { name: '空用户名', body: { username: '', password: 'password' } },
    { name: '纯空白用户名', body: { username: ' \t ', password: 'password' } },
    { name: '过短用户名', body: { username: 'a'.repeat(2), password: 'password' } },
    { name: '超长用户名', body: { username: 'a'.repeat(33), password: 'password' } },
    { name: '缺少密码', body: { username: 'jacky' } },
    { name: '非字符串密码', body: { username: 'jacky', password: 12345678 } },
    { name: '数组密码', body: { username: 'jacky', password: ['password'] } },
    { name: '过短密码', body: { username: 'jacky', password: 'a'.repeat(5) } },
    { name: '超长密码', body: { username: 'jacky', password: 'a'.repeat(17) } },
    { name: '纯空白密码', body: { username: 'jacky', password: ' '.repeat(6) } },
    { name: '仅提供密码哈希', body: { username: 'jacky', passwordHash: 'supplied-hash' } },
  ])('$name 返回 400', async ({ body }) => {
    await expect(validateBody(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('每个字段只保留一条校验错误，同时继续检查其他字段', async () => {
    const validation = validateBody({ username: '', password: '' });

    await expect(validation).rejects.toMatchObject({
      response: {
        statusCode: 400,
        message: expect.arrayContaining([
          expect.stringMatching(/^用户名/),
          expect.stringMatching(/^密码/),
        ]),
      },
    });
    await expect(validation).rejects.toHaveProperty('response.message.length', 2);
  });

  it.each([
    'jac ky',
    '用户abc',
    'abc𠮷',
    'abc😀',
    'ab\tcd',
    'ab\ncd',
    'ab\0cd',
    'ab\x7fcd',
    'abcＡ',
    'ab\u00a0cd',
  ])('拒绝包含非可见 ASCII 字符的用户名 %j', async (username) => {
    await expect(validateBody({ username, password: 'password' })).rejects.toMatchObject({
      response: {
        statusCode: 400,
        message: expect.arrayContaining(['用户名只能包含英文字母、数字和英文符号，不能包含空格']),
      },
    });
  });

  it.each([
    'abc汉字d',
    'pass😀word',
    'abc\nxyz',
    'abcdef\n',
    'abcdef\r',
    'ab\tcde',
    'abc\0def',
    'abc\x7fdef',
    'abc\u00a0def',
  ])('拒绝密码中的非 ASCII 或控制字符 %j', async (password) => {
    await expect(validateBody({ username: 'jacky', password })).rejects.toMatchObject({
      response: {
        statusCode: 400,
        message: expect.arrayContaining(['密码只能包含英文字母、数字、英文符号和空格']),
      },
    });
  });

  it.each([
    { username: 'a'.repeat(3), password: 'a'.repeat(6) },
    { username: 'a'.repeat(32), password: 'a'.repeat(16) },
  ])('接受用户名和密码的长度边界：$username', async (body) => {
    const dto = await validateBody(body);
    expect(dto).toBeInstanceOf(RegisterDto);
    expect(dto).toEqual(body);
  });

  it.each(['jacky123', '123456', '!@#$%^&*()', 'jacky@example.com', './:;<=>?[\\]^_`{|}~'])(
    '允许英文字母数字或符号用户名 %s，不要求字符类别组合',
    async (username) => {
      await expect(validateBody({ username, password: 'password' })).resolves.toMatchObject({
        username,
      });
    },
  );

  it.each(['123456', '!@#$%^', ' pass ', 'abc def', '  pass word  '])(
    '保留有效 ASCII 密码 %j 的原文',
    async (password) => {
      await expect(validateBody({ username: 'jacky', password })).resolves.toMatchObject({
        password,
      });
    },
  );

  it('先清理用户名首尾空白再校验长度，并剔除额外字段', async () => {
    const username = 'a'.repeat(32);
    const dto = await validateBody({
      username: ` \t${username}\n `,
      password: ' pass word ',
      id: 999,
      passwordHash: 'supplied-hash',
      role: 'admin',
    });

    expect(dto).toBeInstanceOf(RegisterDto);
    expect(dto).toEqual({ username, password: ' pass word ' });
  });

  it('控制器保留 RegisterDto 运行时参数类型，供 ValidationPipe 识别', () => {
    expect(Reflect.getMetadata('design:paramtypes', AuthController.prototype, 'register')).toEqual([
      RegisterDto,
    ]);
  });
});
