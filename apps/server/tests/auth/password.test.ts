import { beforeAll, describe, expect, it } from 'vite-plus/test';
import { hashPassword, verifyPassword } from '../../src/auth/password.util.js';

const legacyHash =
  'scrypt$131072$8$1$00112233445566778899aabbccddeeff$74172bfdf2deccbf4b83a85996eb58d796793aa32a5209d12fd74ac0040791a1392d25dcdfe9a7fac1087409882a0759e30be967a5959f77289f962c74ae024b';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(' pass word ');
});

describe('密码哈希', () => {
  it('校验 Argon2id 哈希，密码首尾空格参与校验', async () => {
    expect(await verifyPassword(' pass word ', passwordHash)).toBe(true);
    expect(await verifyPassword('pass word', passwordHash)).toBe(false);
    expect(await verifyPassword('wrong-password', passwordHash)).toBe(false);
  });

  it('新密码使用独立随机盐，生成的哈希能够校验', async () => {
    const first = await hashPassword('test-password');
    const second = await hashPassword('test-password');

    expect(first).toMatch(/^\$argon2id\$v=19\$/);
    expect(first.split('$')[4]).not.toBe(second.split('$')[4]);
    expect(first).not.toBe(second);
    expect(first).not.toContain('test-password');
    expect(await verifyPassword('test-password', first)).toBe(true);
    expect(await verifyPassword('test-password', second)).toBe(true);
  });

  it.each([
    '',
    'plaintext-password',
    legacyHash,
    '$argon2id$',
    '$argon2id$v=19$m=65536,t=3,p=4$invalid-salt$invalid-hash',
  ])('损坏或不受支持的哈希返回 false：%j', async (hash) => {
    expect(await verifyPassword(' pass word ', hash)).toBe(false);
  });

  it('损坏的 Argon2 参数或额外字段返回 false', async () => {
    expect(await verifyPassword(' pass word ', passwordHash.replace('t=3', 't=0'))).toBe(false);
    expect(await verifyPassword(' pass word ', `${passwordHash}$extra`)).toBe(false);
  });
});
