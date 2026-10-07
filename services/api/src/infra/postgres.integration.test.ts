import assert from "node:assert/strict";
import test from "node:test";

test("postgres accepts a migrated emergency profile table", async (t) => {
  if (process.env.GUARDIAN_PG_TEST !== "1") {
    t.skip("Set GUARDIAN_PG_TEST=1 against a migrated Guardian database.");
    return;
  }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    assert.equal(Number(rows[0]?.ok), 1);
    await prisma.$queryRaw`SELECT "userId" FROM "EmergencyProfile" LIMIT 1`;
    await prisma.$queryRaw`SELECT "tokenHash" FROM "IncidentRoom" LIMIT 1`;
    await prisma.$queryRaw`SELECT "revokedAt", "fcmToken" FROM "Device" LIMIT 1`;
    await prisma.$queryRaw`SELECT "invitationToken", "guardianUserId" FROM "TrustedContact" LIMIT 1`;
    await prisma.$queryRaw`SELECT "claimedBy", "escalatedToSupervisorAt" FROM "Incident" LIMIT 1`;
  } finally {
    await prisma.$disconnect();
  }
});
