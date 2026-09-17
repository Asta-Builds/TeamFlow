import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { HUMAN_ROLES } from '../../common/workspace.js';

export class UpdateMemberRoleDto {
  @ApiProperty({
    description: 'Workspace role for the person (ceo, admin or member)',
    enum: HUMAN_ROLES,
    example: 'admin',
  })
  @IsString()
  @IsIn(HUMAN_ROLES)
  role!: string;
}
