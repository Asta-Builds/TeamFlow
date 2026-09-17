import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List recent notifications for the logged in user' })
  async findAll(@CurrentUser() user: any) {
    return this.notificationsService.findAll(user);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markAsRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.notificationsService.markAsRead(id, user);
  }

  @Post([':id/read', ':id/read/'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read (POST alias used by the web app)' })
  async markAsReadPost(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.notificationsService.markAsRead(id, user);
  }

  @Post(['mark-all-read', 'read_all', 'read_all/'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllRead(user);
  }
}
