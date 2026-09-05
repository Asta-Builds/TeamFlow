import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUrl } from 'class-validator';

export class CreateSeoAuditDto {
  @ApiProperty({ example: 'https://teamflow.dev' })
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  url!: string;
}
