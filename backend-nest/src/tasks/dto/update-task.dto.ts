import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  Min,
  Max,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'Implement distributed locking' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    example: 'Use Redis Redlock algorithm for distributed coordination',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'in_progress',
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
  assignee?: number | null;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  due_date?: string | null;

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

  @ApiPropertyOptional({ example: 100.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  contract_compliance_score?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  qa_rejected?: boolean;

  @ApiPropertyOptional({ example: '' })
  @IsOptional()
  @IsString()
  qa_rejection_reason?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  order?: number;
}
