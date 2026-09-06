import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class InviteMemberDto {
  @ApiProperty({
    description: 'Email address of the user to invite to the workspace',
    example: 'engineer@nexus.ai',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiPropertyOptional({
    description: 'Full display name for the invited member',
    example: 'Taylor Swift',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Role to assign within the workspace (member, tech_lead, backend, frontend, qa, devops, designer, seo, admin)',
    example: 'member',
  })
  @IsOptional()
  @IsString()
  role?: string;
}
