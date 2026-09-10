import { describe, expect, it, vi } from 'vitest';
import { McpService } from './mcp.service.js';

describe('McpService', () => {
  const principal = { resolve: vi.fn() };
  const organizations = { getCurrent: vi.fn() };
  const projects = { findAll: vi.fn(), findOne: vi.fn(), create: vi.fn(), update: vi.fn() };
  const tasks = {
    findAll: vi.fn(),
    findOne: vi.fn(),
    getFeed: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    addComment: vi.fn(),
  };
  const pulse = {
    getDashboard: vi.fn(),
    getNote: vi.fn(),
    getPlanItems: vi.fn(),
    updateNote: vi.fn(),
    createPlanItem: vi.fn(),
    deletePlanItem: vi.fn(),
  };

  it('registers the approved v1 workspace tools and no destructive project delete tool', () => {
    const service = new McpService(
      principal as any,
      organizations as any,
      projects as any,
      tasks as any,
      pulse as any,
    );
    const tools = (service.server as any)._registeredTools;

    expect(tools).toHaveProperty('teamflow_get_workspace');
    expect(tools).toHaveProperty('teamflow_create_project');
    expect(tools).toHaveProperty('teamflow_update_task');
    expect(tools).toHaveProperty('teamflow_update_pulse_note');
    expect(tools).not.toHaveProperty('teamflow_delete_project');
    expect(tools).not.toHaveProperty('teamflow_qa_validate_task');
    expect(tools).not.toHaveProperty('teamflow_deploy');
  });

  it('returns a safe MCP error instead of propagating a domain failure', async () => {
    principal.resolve.mockRejectedValueOnce(new Error('unexpected'));
    const service = new McpService(
      principal as any,
      organizations as any,
      projects as any,
      tasks as any,
      pulse as any,
    );

    const result = await (service as any).run(
      { authInfo: undefined },
      'teamflow_get_workspace',
      false,
      async () => ({ ok: true }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('could not be completed');
  });
});
