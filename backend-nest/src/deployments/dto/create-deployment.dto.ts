import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreateDeploymentDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  project!: number;

  @ApiPropertyOptional({ example: 'production', enum: ['dev', 'staging', 'production'] })
  @IsOptional()
  @IsIn(['dev', 'staging', 'production'])
  environment?: string;

  @ApiPropertyOptional({ example: 'main' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  branch?: string;

  @ApiPropertyOptional({ example: '4a9b2c3' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{0,40}$/i)
  commit_sha?: string;
}
