import type { RegisterRequest } from '@nestjs-agent/shared';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class RegisterDto implements RegisterRequest {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '用户名必须是字符串' })
  @Length(3, 32, { message: '用户名须为 3–32 个字符' })
  @Matches(/^[\x21-\x7E]+$/, {
    message: '用户名只能包含英文字母、数字和英文符号，不能包含空格',
  })
  username!: string;

  @IsString({ message: '密码必须是字符串' })
  @Length(6, 16, { message: '密码须为 6–16 个字符' })
  // 严格匹配到字符串末尾，避免 $ 放过末尾换行。
  @Matches(/^[\x20-\x7E]+(?![\s\S])/, {
    message: '密码只能包含英文字母、数字、英文符号和空格',
  })
  @Matches(/\S/, { message: '密码不能全为空格' })
  password!: string;
}
