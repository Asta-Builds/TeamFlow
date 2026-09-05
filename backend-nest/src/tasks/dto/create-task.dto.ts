import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  Min,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  project!: number;

  @ApiProperty({ example: 'Implement distributed locking' })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiPropertyOptional({
    example: 'Use Redis Redlock algorithm for distributed coordination',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'todo',
    enum: ['todo', 'in_progress', 'in_review', 'qa', 'done'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['todo', 'in_progress', 'in_review', 'qa', 'done'])
  status?: string;

  @ApiPropertyOptional({ example: 'feature', enum: ['feature', 'bug', 'task'] })
  @IsOptional()
  @IsString()
  @IsIn(['feature', 'bug', 'task'])
  task_type?: string;

  @ApiPropertyOptional({
    example: 'high',
    enum: ['low', 'medium', 'high', 'urgent'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  assignee?: number;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional({
    example: 'https://github.com/Asta-Builds/TeamFlow/pull/42',
  })
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
