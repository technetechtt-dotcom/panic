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
    await prisma.$queryRaw`SELECT "providerMessageId", "deliveredAt", "failedAt" FROM "NotificationDelivery" LIMIT 1`;
    await prisma.$queryRaw`SELECT "acceptedAt", "enRouteAt", "arrivedAt", "locatedAt", "completedAt", "declinedAt" FROM "ResponderAssignment" LIMIT 1`;
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS backup_probe (id text primary key, note text)`;
    await prisma.$executeRaw`INSERT INTO backup_probe (id, note) VALUES ('probe-1', 'live') ON CONFLICT (id) DO UPDATE SET note = 'live'`;
    const dumped = await prisma.$queryRaw<Array<{ id: string; note: string }>>`SELECT id, note FROM backup_probe`;
    await prisma.$executeRaw`DELETE FROM backup_probe`;
    for (const row of dumped) {
      await prisma.$executeRaw`INSERT INTO backup_probe (id, note) VALUES (${row.id}, ${row.note})`;
    }
    const restored = await prisma.$queryRaw<Array<{ note: string }>>`SELECT note FROM backup_probe WHERE id = 'probe-1'`;
    assert.equal(restored[0]?.note, "live");
  } finally {
    await prisma.$disconnect();
  }
});
