const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

function getDisplaySecretKey(secretKey) {
  return secretKey.slice(0, 6) + "..." + secretKey.slice(-4);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function createShaHash(secretKey, salt) {
  return crypto.createHash("sha256")
    .update(secretKey)
    .update(crypto.createHash("sha256").update(salt, "utf8").digest("hex"))
    .digest("hex");
}

async function seed() {
  const salt = requireEnv("LANGFUSE_SALT");
  const orgId = requireEnv("LANGFUSE_ORG_ID");
  const projectId = requireEnv("LANGFUSE_PROJECT_ID");
  const userId = requireEnv("LANGFUSE_ADMIN_ID");
  const publicKey = requireEnv("LANGFUSE_PUBLIC_KEY");
  const secretKey = requireEnv("LANGFUSE_SECRET_KEY");
  const adminEmail = requireEnv("LANGFUSE_ADMIN_EMAIL");
  const adminName = requireEnv("LANGFUSE_ADMIN_NAME");
  const adminPassword = requireEnv("LANGFUSE_ADMIN_PASSWORD");

  // 1. Create or update user
  const hashedPassword = await bcrypt.hash(adminPassword, 12);
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: adminName },
    create: {
      id: userId,
      name: adminName,
      email: adminEmail,
      password: hashedPassword,
      admin: true,
    },
  });
  console.log("User seeded:", user.email);

  // 2. Create or update organization
  const org = await prisma.organization.upsert({
    where: { id: orgId },
    update: { name: process.env.LANGFUSE_ORG_NAME || orgId },
    create: {
      id: orgId,
      name: process.env.LANGFUSE_ORG_NAME || orgId,
    },
  });
  console.log("Org seeded:", org.name);

  // 3. Org membership
  const orgMembership = await prisma.organizationMembership.upsert({
    where: {
      orgId_userId: {
        orgId: org.id,
        userId: user.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      orgId: org.id,
      userId: user.id,
      role: "OWNER",
    },
  });
  console.log("Org membership seeded");

  // 4. Project
  const project = await prisma.project.upsert({
    where: { id: projectId },
    update: { name: process.env.LANGFUSE_PROJECT_NAME || projectId, orgId: org.id },
    create: {
      id: projectId,
      name: process.env.LANGFUSE_PROJECT_NAME || projectId,
      orgId: org.id,
    },
  });
  console.log("Project seeded:", project.name, project.id);

  // 5. Project membership
  await prisma.projectMembership.upsert({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: user.id,
      },
    },
    update: { role: "ADMIN", orgMembershipId: orgMembership.id },
    create: {
      projectId: project.id,
      userId: user.id,
      role: "ADMIN",
      orgMembershipId: orgMembership.id,
    },
  });
  console.log("Project membership seeded");

  // 6. API Key
  const hashedSecretKey = await bcrypt.hash(secretKey, 11);
  const fastHashedSecretKey = createShaHash(secretKey, salt);
  const displaySecretKey = getDisplaySecretKey(secretKey);

  await prisma.apiKey.deleteMany({
    where: { publicKey: publicKey },
  });

  const apiKey = await prisma.apiKey.create({
    data: {
      id: requireEnv("LANGFUSE_API_KEY_ID"),
      projectId: project.id,
      publicKey: publicKey,
      hashedSecretKey: hashedSecretKey,
      fastHashedSecretKey: fastHashedSecretKey,
      displaySecretKey: displaySecretKey,
      note: process.env.LANGFUSE_API_KEY_NOTE || "Seeded API key",
    },
  });
  console.log("API Key seeded successfully:", apiKey.publicKey, apiKey.displaySecretKey);
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
