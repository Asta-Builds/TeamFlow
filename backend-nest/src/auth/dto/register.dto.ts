import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@company.example' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({ example: 'Tech Lead' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'TeamFlow HQ' })
  @IsOptional()
  @IsString()
  organization_name?: string;
}
