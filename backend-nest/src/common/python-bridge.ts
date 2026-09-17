import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { HttpService } from '@nestjs/axios';
import { requireSecret } from '../auth/security.js';

/**
 * Authenticated calls from NestJS to the Django execution service
 * (agents, git provisioning, deployments). Django re-checks the caller's
 * role and tenant using the short-lived token issued here.
 */

export function pythonServiceUrl(): string {
  return (process.env.PYTHON_AI_SERVICE_URL || '').replace(/\/+$/, '');
}

export function bridgeHeaders(user: { id: number }): Record<string, string> {
  const token = new JwtService().sign(
    { user_id: user.id, token_type: 'access', jti: randomUUID() },
    {
      secret: requireSecret('PYTHON_AI_JWT_SECRET'),
      algorithm: 'HS256',
      expiresIn: '60s',
    },
  );
  return { Authorization: `Bearer ${token}` };
}

export interface BridgeResponse<T = any> {
  status: number;
  data: T;
}

/** GET from Django with the same error mapping as `bridgePost`. */
export async function bridgeGet<T = any>(
  http: HttpService,
  user: { id: number },
  path: string,
  timeoutMs = 15000,
): Promise<BridgeResponse<T>> {
  return bridgeRequest<T>(http, user, 'get', path, undefined, timeoutMs);
}

/**
 * POST to Django and return its response for 2xx and 502 results.
 * Client errors are passed through; everything else becomes 503.
 */
export async function bridgePost<T = any>(
  http: HttpService,
  user: { id: number },
  path: string,
  body: unknown,
  timeoutMs = 20000,
): Promise<BridgeResponse<T>> {
  return bridgeRequest<T>(http, user, 'post', path, body ?? {}, timeoutMs);
}

async function bridgeRequest<T>(
  http: HttpService,
  user: { id: number },
  method: 'get' | 'post',
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<BridgeResponse<T>> {
  const baseUrl = pythonServiceUrl();
  if (!baseUrl) {
    throw new ServiceUnavailableException(
      'The TeamFlow execution service is not configured',
    );
  }

  let response;
  try {
    const options = {
      headers: bridgeHeaders(user),
      timeout: timeoutMs,
      validateStatus: () => true,
    };
    response =
      method === 'get'
        ? await http.axiosRef.get(`${baseUrl}${path}`, options)
        : await http.axiosRef.post(`${baseUrl}${path}`, body, options);
  } catch {
    throw new ServiceUnavailableException(
      'The TeamFlow execution service is unreachable',
    );
  }

  const { status, data } = response;
  if (status >= 200 && status < 300) return { status, data };
  if (status === 502) return { status, data };
  if (status === 401) {
    // A rejected bridge token is a server misconfiguration, not a user session problem.
    throw new ServiceUnavailableException(
      'The TeamFlow execution service rejected the service credentials',
    );
  }
  if ([400, 403, 404, 409, 422].includes(status)) {
    throw new HttpException(data ?? { detail: 'Request rejected' }, status);
  }
  if (status === 503) {
    throw new ServiceUnavailableException(
      data?.detail || data?.error || 'The requested capability is not configured',
    );
  }
  throw new BadGatewayException('The TeamFlow execution service failed');
}
