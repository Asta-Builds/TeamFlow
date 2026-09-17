// Exercises the workspace membership flows against a real database.
// Run only against a throwaway database: it creates accounts and workspaces.
//   DATABASE_URL=postgres://.../test_teamflow npm run test:membership-flow
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../dist/auth/auth.service.js';
import { JwtStrategy } from '../dist/auth/jwt.strategy.js';
import { OrganizationsService } from '../dist/organizations/organizations.service.js';
import { UsersService } from '../dist/users/users.service.js';
import { requireTenantUsers } from '../dist/common/access.js';

if (!/check|test/i.test(process.env.DATABASE_URL || '')) {
  throw new Error('Refusing to run: DATABASE_URL must name a throwaway check/test database');
}
process.env.JWT_SECRET ||= randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET ||= randomBytes(32).toString('hex');
process.env.AGENT_EMAIL_DOMAIN ||= 'agents.test';
const agentDomain = process.env.AGENT_EMAIL_DOMAIN;

const prisma = new PrismaClient();
const jwt = new JwtService();
const clerk = { verifyClerkSession: async () => clerkIdentity };
let clerkIdentity;
const auth = new AuthService(prisma, jwt, undefined, clerk);
const strategy = new JwtStrategy(prisma);
const orgs = new OrganizationsService(prisma, auth);
const users = new UsersService(prisma);
const run = randomUUID().slice(0, 8);
const email = (name) => `${name}-${run}@example.test`;

async function principal(session) {
  const { sid, user_id } = jwt.decode(session.access);
  return strategy.validate({ user_id, sid, token_type: 'access' });
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (err) => {
    assert.match(err.message, pattern);
    return true;
  });
}

try {
  // Sign-up: every new person founds a workspace as its CEO.
  const alice = await auth.register({ email: email('alice'), password: 'alice-password-1', name: 'Alice' });
  const bob = await auth.register({ email: email('bob'), password: 'bob-password-1', name: 'Bob', role: 'admin' });
  assert.equal(alice.user.role, 'ceo');
  assert.equal(bob.user.role, 'ceo');
  assert.notEqual(alice.user.organization, bob.user.organization);
  let a = await principal(alice);
  let b = await principal(bob);
  assert.equal(a.role, 'ceo');

  // Agent addresses and agent seats cannot sign in.
  await rejects(auth.register({ email: `pm+organization-1@${agentDomain}`, password: 'x-password-1' }), /reserved/);
  await prisma.user.create({
    data: {
      email: `qa+organization-${a.organizationId}@${agentDomain}`,
      password: '!agent',
      role: 'qa',
      agentKey: 'qa',
      organizationId: a.organizationId,
    },
  });

  // Invitations never move people and must be accepted.
  await rejects(orgs.inviteMember(a, { email: email('bob'), role: 'backend' }), /Unsupported role/);
  const invite = await orgs.inviteMember(a, { email: email('bob') });
  assert.equal(invite.membership_status, 'invited');
  b = await principal(bob);
  assert.equal(b.organizationId, bob.user.organization, 'invitation must not move Bob');
  let bobWorkspaces = await orgs.findAll(b);
  assert.deepEqual(
    bobWorkspaces.map((w) => [w.name, w.role, w.membership_status, w.is_current, w.invited_by]),
    [
      [`Bob's workspace`, 'ceo', 'active', true, null],
      [`Alice's workspace`, 'member', 'invited', false, 'Alice'],
    ],
  );
  let team = await users.findAll(a);
  assert.deepEqual(
    team.map((u) => [u.email, u.role, u.membership_status]).sort(),
    [
      [email('alice'), 'ceo', 'active'],
      [email('bob'), 'member', 'invited'],
    ],
  );
  await rejects(requireTenantUsers(prisma, [b.id], a), /must belong/);

  // Accepting switches Bob into Alice's workspace as a member.
  const accepted = await orgs.switchOrganization(b, a.organizationId);
  b = await principal(accepted);
  assert.equal(b.organizationId, a.organizationId);
  assert.equal(b.role, 'member');
  await requireTenantUsers(prisma, [b.id], a);
  await rejects(orgs.inviteMember(b, { email: email('carol') }), /administrators/);

  // Role changes follow the seat; only the CEO manages admins.
  await orgs.updateMemberRole(a, b.id, 'admin');
  b = await principal(bob);
  assert.equal(b.role, 'admin');
  await rejects(orgs.updateMemberRole(b, a.id, 'member'), /workspace owners/);
  await rejects(users.update(a.id, { is_active: false }, b), /workspace owners/);
  await rejects(orgs.leaveOrganization(a, a.organizationId), /at least one owner/);

  // Bob switches back home; his role there is still CEO.
  b = await principal(await orgs.switchOrganization(b, bob.user.organization));
  assert.equal(b.role, 'ceo');
  team = await users.findAll(a);
  assert.equal(team.find((u) => u.email === email('bob')).role, 'admin');
  assert.equal(team.find((u) => u.email === email('bob')).organization_name, `Alice's workspace`);

  // A new email gets a placeholder; signing up claims it without accepting.
  await orgs.inviteMember(a, { email: email('carol'), name: 'Carol' });
  await rejects(orgs.inviteMember(a, { email: email('carol') }), /pending invitation/);
  const carol = await auth.register({ email: email('carol'), password: 'carol-password-1' });
  let c = await principal(carol);
  assert.equal(c.role, 'ceo');
  assert.notEqual(c.organizationId, a.organizationId);
  const carolWorkspaces = await orgs.findAll(c);
  assert.deepEqual(carolWorkspaces.map((w) => w.membership_status).sort(), ['active', 'invited']);
  c = await principal(await orgs.leaveOrganization(c, a.organizationId));
  assert.equal((await orgs.findAll(c)).length, 1, 'declined invitation is gone');

  // Clerk: an invited account signs in, gets its own workspace, keeps the invitation.
  await orgs.inviteMember(a, { email: email('dave') });
  clerkIdentity = { clerk_id: `user_${run}`, email: email('dave'), name: 'Dave' };
  const dave = await auth.clerkLogin({ token: 'verified' });
  const d = await principal(dave);
  assert.equal(d.role, 'ceo');
  assert.equal(dave.user.organization_name, `Dave's workspace`);
  assert.equal(dave.user.organization_tier, 'starter');
  assert.equal(dave.user.user_status, 'active');
  assert.equal((await orgs.findAll(d)).filter((w) => w.membership_status === 'invited').length, 1);

  // Removing Bob sends his active workspace back to his own.
  b = await principal(await orgs.switchOrganization(b, a.organizationId));
  await orgs.removeMember(a, b.id);
  b = await principal(bob);
  assert.equal(b.organizationId, bob.user.organization);
  assert.equal(b.role, 'ceo');
  await rejects(users.findOne(b.id, a), /Access denied/);

  // Sessions of a person whose seat disappeared out of band fail closed.
  await prisma.membership.deleteMany({ where: { userId: b.id } });
  b = await principal(bob);
  assert.equal(b.organizationId, null);
  const relogin = await auth.login({ email: email('bob'), password: 'bob-password-1' });
  assert.equal(relogin.user.role, 'ceo', 'sign-in founds a new workspace when none is left');
  assert.notEqual(relogin.user.organization, bob.user.organization);

  // Agent seats never sign in, even with a known password.
  await rejects(
    auth.login({ email: `qa+organization-${a.organizationId}@${agentDomain}`, password: '!agent' }),
    /Invalid email or password/,
  );

  console.log('membership flow checks passed');
} finally {
  await prisma.$disconnect();
}
