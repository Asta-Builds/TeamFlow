import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateSeoTaskDto {
  @ApiProperty({ example: 1, description: 'Target project ID to create task ticket in' })
  @IsInt()
  @IsNotEmpty()
  project_id!: number;

  @ApiPropertyOptional({ example: 0, description: 'Index of issue in audit.issues list' })
  @IsOptional()
  @IsInt()
  issue_index?: number;
}
