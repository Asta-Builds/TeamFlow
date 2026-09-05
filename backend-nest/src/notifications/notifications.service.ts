import { requireOrganization } from '../common/access.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  private mapNotification(n: any) {
    return {
      id: n.id,
      title: n.title,
      message: n.message,
      link: n.link,
      is_read: n.isRead,
      actor: n.actorId,
      actor_detail: n.actor
        ? {
            id: n.actor.id,
            name: n.actor.name,
            email: n.actor.email,
            avatar_url: n.actor.avatarUrl,
          }
        : null,
      created_at: n.createdAt.toISOString(),
    };
  }

  async findAll(user: any) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        recipientId: user.id,
        organizationId: requireOrganization(user),
      },
      include: {
        actor: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return notifications.map((n) => this.mapNotification(n));
  }

  async markAsRead(id: number, user: any) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (
      !notification ||
      notification.recipientId !== user.id ||
      notification.organizationId !== requireOrganization(user)
    ) {
      throw new NotFoundException(`Notification #${id} not found`);
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
      include: { actor: true },
    });

    return this.mapNotification(updated);
  }

  async markAllRead(user: any) {
    await this.prisma.notification.updateMany({
      where: {
        recipientId: user.id,
        organizationId: requireOrganization(user),
        isRead: false,
      },
      data: { isRead: true },
    });

    return { success: true, message: 'All notifications marked as read' };
  }
}
