import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as bcrypt from 'bcryptjs';

const deriveKey = promisify(pbkdf2);

export function requireSecret(name: string): string {
  const secret = process.env[name];
  if (
    !secret ||
    secret.length < 32 ||
    secret.includes('teamflow-secret') ||
    secret.includes('teamflow-refresh-secret')
  ) {
    throw new Error(
      `${name} must contain a unique random secret of at least 32 characters`,
    );
  }
  return secret;
}

// Use Django's default encoding so both services can verify new passwords.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const iterations = 1_200_000;
  const hash = await deriveKey(password, salt, iterations, 32, 'sha256');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  if (/^\$2[ab]\$/.test(encoded)) return bcrypt.compare(password, encoded);
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 10_000_000
  )
    return false;
  const expected = Buffer.from(parts[3], 'base64');
  if (expected.length !== 32 || !parts[2]) return false;
  const actual = await deriveKey(password, parts[2], iterations, 32, 'sha256');
  return timingSafeEqual(expected, actual);
}
