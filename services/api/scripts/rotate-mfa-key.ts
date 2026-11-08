/** Run with --env-file and --import tsx. Key values must come from the secret manager, never arguments. */
import { PrismaClient } from "@prisma/client";
import { openSecret, sealSecret } from "../src/domain/security";
const previous = process.env.MFA_LEGACY_ENCRYPTION_KEY;
const next = process.env.MFA_ENCRYPTION_KEY;
if (!previous || !next || next.length < 32 || next === process.env.JWT_ACCESS_SECRET) throw new Error("Set separate legacy and destination MFA encryption keys via the environment.");
const prisma = new PrismaClient();
try {
  const count = await prisma.$transaction(async tx => {
    const rows = await tx.operatorMfa.findMany();
    for (const row of rows) {
      const rewrap = (value: string) => { if (!value.startsWith("enc:v1:")) return sealSecret(value, next); try { openSecret(value, next); return value; } catch { return sealSecret(openSecret(value, previous), next); } };
      await tx.operatorMfa.update({ where: { userId: row.userId }, data: { secret: rewrap(row.secret), pendingSecret: row.pendingSecret ? rewrap(row.pendingSecret) : null } });
    }
    return rows.length;
  }, { timeout: 60_000 });
  console.log(JSON.stringify({ rotatedRecords: count }));
} finally { await prisma.$disconnect(); }
