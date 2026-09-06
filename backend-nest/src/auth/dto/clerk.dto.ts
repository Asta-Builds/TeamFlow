import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class ClerkDto {
  @ApiPropertyOptional({
    description: 'Direct Clerk session JWT token passed from frontend client',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18zSWVKNHN...',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description: 'Clerk User identifier (e.g. user_2xxx)',
    example: 'user_2xyz123456789',
  })
  @IsOptional()
  @IsString()
  clerk_id?: string;

  @ApiPropertyOptional({
    description: 'User primary email address verified by Clerk',
    example: 'alex@teamflow.dev',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'User full display name from Clerk user profile',
    example: 'Alex Founder',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Avatar image URL from Clerk profile',
    example: 'https://img.clerk.com/xxxx',
  })
  @IsOptional()
  @IsString()
  avatar_url?: string;
}
