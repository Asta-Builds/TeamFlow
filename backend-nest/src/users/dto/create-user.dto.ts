import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'engineer@teamflow.dev' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'InitialPass123!' })
  @IsNotEmpty()
  @IsString()
  password!: string;

  @ApiPropertyOptional({ example: 'Senior Engineer' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'backend' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  user_status?: string;
}
