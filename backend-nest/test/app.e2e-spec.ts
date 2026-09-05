import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

// Exercise compiled code so Nest's emitted DI metadata matches production.
describe('HTTP authentication and tenant boundaries', () => {
  let app: INestApplication;
  let access: string;
  const user = { id: 1, organizationId: 10, role: 'member', isActive: true };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    comment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    task: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
  };

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'http-test-access-secret-'.repeat(3));
    vi.stubEnv('JWT_REFRESH_SECRET', 'http-test-refresh-secret-'.repeat(3));
    const { AppModule } = await import('../dist/app.module.js');
    const { PrismaService } = await import('../dist/prisma/prisma.service.js');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    access = new JwtService().sign(
      { user_id: 1, token_type: 'access' },
      { secret: process.env.JWT_SECRET, expiresIn: '5m' },
    );
  });
  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });
  beforeEach(() => vi.clearAllMocks());

  it('serves API metadata rather than the old Hello World fixture', async () => {
    const response = await request(app.getHttpServer()).get('/api').expect(200);
    expect(response.body.name).toBe('TeamFlow NestJS Core API');
  });
  it('rejects unauthenticated comment enumeration', async () => {
    await request(app.getHttpServer()).get('/api/comments').expect(401);
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });
  it('passes the authenticated user into comment scoping', async () => {
    await request(app.getHttpServer())
      .get('/api/comments')
      .auth(access, { type: 'bearer' })
      .expect(200, []);
    expect(prisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          task: {
            organizationId: 10,
            project: {
              organizationId: 10,
              OR: [{ ownerId: 1 }, { members: { some: { userId: 1 } } }],
            },
          },
        },
      }),
    );
  });
  it('rejects cross-project comment creation without persisting', async () => {
    await request(app.getHttpServer())
      .post('/api/comments')
      .auth(access, { type: 'bearer' })
      .send({ task: 99, body: 'hidden task' })
      .expect(404);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });
  it('enforces DTO validation on task status', async () => {
    await request(app.getHttpServer())
      .patch('/api/tasks/99')
      .auth(access, { type: 'bearer' })
      .send({ status: 'not-a-status' })
      .expect(400);
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
  });
  it('rejects refresh-typed tokens even with a valid access signature', async () => {
    const token = new JwtService().sign(
      { user_id: 1, token_type: 'refresh' },
      { secret: process.env.JWT_SECRET },
    );
    await request(app.getHttpServer())
      .get('/api/comments')
      .auth(token, { type: 'bearer' })
      .expect(401);
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });
});
