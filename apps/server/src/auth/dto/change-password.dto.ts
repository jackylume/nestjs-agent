import type { ChangePasswordRequest } from '@nestjs-agent/shared';
import { IsString, Length, Matches } from 'class-validator';

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString({ message: '旧密码必须是字符串' })
  @Length(6, 16, { message: '旧密码须为 6–16 个字符' })
  @Matches(/^[\x20-\x7E]+(?![\s\S])/, {
    message: '旧密码只能包含英文字母、数字、英文符号和空格',
  })
  @Matches(/\S/, { message: '旧密码不能全为空格' })
  oldPassword!: string;

  @IsString({ message: '新密码必须是字符串' })
  @Length(6, 16, { message: '新密码须为 6–16 个字符' })
  @Matches(/^[\x20-\x7E]+(?![\s\S])/, {
    message: '新密码只能包含英文字母、数字、英文符号和空格',
  })
  @Matches(/\S/, { message: '新密码不能全为空格' })
  newPassword!: string;
}
