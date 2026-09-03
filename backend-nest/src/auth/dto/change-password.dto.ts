import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPass123' })
  @IsNotEmpty()
  @IsString()
  old_password!: string;

  @ApiProperty({ example: 'NewPass123!' })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  new_password!: string;
}
