import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SeoService } from './seo.service.js';

describe('SeoService', () => {
  let service: any;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      sEOAudit: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          return { id: 1, ...data, createdAt: new Date() };
        }),
      },
    };
    const httpServiceMock = {
      axiosRef: {
        get: vi.fn().mockResolvedValue({
          data: '<html><head><title>Test</title><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><h1>Hello</h1></body></html>',
          headers: { 'content-type': 'text/html' },
        }),
      },
    };
    
    service = new SeoService(prismaMock as any, httpServiceMock as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs an audit on a valid URL and parses metrics correctly', async () => {
    const audit = await service.create({ url: 'https://example.com' }, { id: 1, organizationId: 1, role: 'ceo' });
    
    expect(audit.url).toBe('https://example.com');
    expect(audit.metrics).toBeDefined();
    expect((audit.metrics as any).measured_with).toBe('http_fetch');
    expect(typeof (audit.metrics as any).response_time_ms).toBe('number');
    expect((audit.metrics as any).fcp_ms).toBeUndefined();
    expect(audit.score).toBeGreaterThan(0);
    expect(prismaMock.sEOAudit.create).toHaveBeenCalled();
  });

  it('uses SEO_LOCAL_TARGET_REWRITES when privateTargetsAllowed is true', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OUTBOUND_ALLOW_PRIVATE_HOSTS', 'true');
    vi.stubEnv('SEO_LOCAL_TARGET_REWRITES', 'localhost=frontend,127.0.0.1=frontend');
    
    await service.create({ url: 'http://localhost' }, { id: 1, organizationId: 1, role: 'ceo' });
    
    // Check what httpService.axiosRef.get was called with
    const getCall = service.httpService.axiosRef.get.mock.calls[0][0];
    expect(getCall).toContain('frontend');
    
    vi.unstubAllEnvs();
  });
});
