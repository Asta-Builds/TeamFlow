import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  @ApiPropertyOptional({
    description: 'Updated name of the workspace organization',
    example: 'Nexus AI Enterprise',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}
