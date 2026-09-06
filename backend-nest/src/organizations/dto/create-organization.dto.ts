import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({
    description: 'Name of the new tenant organization / workspace',
    example: 'Nexus AI Labs',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    description: 'Initial subscription tier (starter, growth, enterprise)',
    example: 'starter',
  })
  @IsOptional()
  @IsString()
  tier?: string;
}
