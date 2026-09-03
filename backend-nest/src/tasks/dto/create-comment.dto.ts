import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCommentDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  task?: number;

  @ApiProperty({ example: '@tech_lead please review PR #42' })
  @IsNotEmpty()
  @IsString()
  body!: string;
}
