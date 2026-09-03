import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class QaRejectDto {
  @ApiProperty({ example: 'Integration test failed: Token expiration handled incorrectly' })
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
