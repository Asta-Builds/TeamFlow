import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateDeploymentDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  project!: number;

  @ApiPropertyOptional({ example: 'production', enum: ['dev', 'staging', 'production'] })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ example: 'main' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ example: '4a9b2c3' })
  @IsOptional()
  @IsString()
  commit_sha?: string;
}
