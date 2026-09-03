import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  project!: number;

  @ApiProperty({ example: 'Implement distributed locking' })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiPropertyOptional({ example: 'Use Redis Redlock algorithm for distributed coordination' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'todo', enum: ['todo', 'in_progress', 'in_review', 'qa', 'done'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'feature', enum: ['feature', 'bug', 'task'] })
  @IsOptional()
  @IsString()
  task_type?: string;

  @ApiPropertyOptional({ example: 'high', enum: ['low', 'medium', 'high', 'urgent'] })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  assignee?: number;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional({ example: 'https://github.com/Asta-Builds/TeamFlow/pull/42' })
  @IsOptional()
  @IsString()
  pr_url?: string;

  @ApiPropertyOptional({ example: [] })
  @IsOptional()
  @IsArray()
  validation_contract?: any[];

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  order?: number;
}
