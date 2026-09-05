import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class KeycloakDto {
  @ApiPropertyOptional({
    description: 'Authorization code obtained from Keycloak login redirect',
    example: 'd8c47bb6-e26b-4f99-8735-30bb224e2c90.6c39b33a-1299-4c12-9c42-83569d675bb2',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    description: 'Callback redirect URI used during code acquisition',
    example: 'http://localhost:3000/auth/callback',
  })
  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @ApiPropertyOptional({
    description: 'Direct JWT token passed from frontend',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description: 'Access token alternative field',
  })
  @IsOptional()
  @IsString()
  access_token?: string;

  @ApiPropertyOptional({
    description: 'ID token alternative field',
  })
  @IsOptional()
  @IsString()
  id_token?: string;
}
