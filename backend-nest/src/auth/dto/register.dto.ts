import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'lead@teamflow.dev' })
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

  @ApiPropertyOptional({ example: 'tech_lead' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 'TeamFlow HQ' })
  @IsOptional()
  @IsString()
  organization_name?: string;
}
