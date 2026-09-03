import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { PulseModule } from './pulse/pulse.module.js';
import { DeploymentsModule } from './deployments/deployments.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SeoModule } from './seo/seo.module.js';
import { BillingModule } from './billing/billing.module.js';
import { AgentsModule } from './agents/agents.module.js';
import { AppController } from './app.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    TasksModule,
    PulseModule,
    DeploymentsModule,
    NotificationsModule,
    SeoModule,
    BillingModule,
    AgentsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
