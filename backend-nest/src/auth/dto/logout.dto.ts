import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Refresh token to revoke together with the current session',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  refresh?: string;
}
