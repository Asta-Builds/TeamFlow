import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

export class CreatePlanItemDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  task!: number;

  @ApiProperty({ example: '2026-09-03' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ example: 'morning', enum: ['morning', 'afternoon', 'evening'] })
  @IsOptional()
  @IsString()
  time_block?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  position?: number;
}

export class UpdateNoteDto {
  @ApiPropertyOptional({ example: '2026-09-03' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ example: 'Focus on NestJS migration and testing auth endpoints' })
  @IsString()
  body!: string;
}

export class StartFocusSessionDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  plan_item?: number;
}
