import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { hashPassword } from '../dist/auth/security.js';

// No application records or real signing keys are used by this check.
const secret = randomBytes(48).toString('hex');
const password = randomBytes(24).toString('hex');
const token = new JwtService().sign(
  {
    user_id: 123,
    token_type: 'access',
    jti: randomUUID(),
  },
  { secret, algorithm: 'HS256', expiresIn: '60s' },
);
const encoded = await hashPassword(password);
const python = `
import json, os, sys
from unittest.mock import patch
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'teamflow.settings')
import django
django.setup()
from django.contrib.auth.hashers import check_password
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.backends import TokenBackend
from rest_framework_simplejwt.tokens import Token
data = json.load(sys.stdin)
assert check_password(data['password'], data['encoded'])
assert not check_password('incorrect-password', data['encoded'])
backend = TokenBackend(algorithm='HS256', signing_key=data['secret'])
with patch.object(Token, 'get_token_backend', return_value=backend):
    validated = JWTAuthentication().get_validated_token(data['token'].encode())
    assert validated['user_id'] == 123
    assert validated['token_type'] == 'access'
print('Django password verification and SimpleJWT bridge validation passed; no database writes.')
`;
const result = spawnSync(
  'docker',
  [
    'exec',
    '-i',
    process.env.DJANGO_TEST_CONTAINER || 'teamflow-backend',
    'python',
    '-c',
    python,
  ],
  {
    input: JSON.stringify({ secret, password, encoded, token }),
    encoding: 'utf8',
    timeout: 30000,
  },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) process.stderr.write(`${result.error.message}\n`);
process.exitCode = result.status ?? 1;
