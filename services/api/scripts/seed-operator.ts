import { PrismaClient, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ScryptPasswordHasher } from "../src/domain/security";

async function main(): Promise<void> {
  const email = process.env.MONITOR_OPERATOR_EMAIL?.trim().toLowerCase();
  const password = process.env.MONITOR_OPERATOR_PASSWORD ?? "";
  if (!email || password.length < 12) {
    console.error("Set MONITOR_OPERATOR_EMAIL and a MONITOR_OPERATOR_PASSWORD of at least 12 characters.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const hasher = new ScryptPasswordHasher();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== Role.MONITOR_OPERATOR && existing.role !== Role.ADMIN && existing.role !== Role.SUPERVISOR) {
        console.error("That email already belongs to another account. Refusing to change its role.");
        process.exit(1);
      }
      console.log("Operator account already exists. Password was left unchanged.");
      return;
    }
    await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: await hasher.hash(password),
        displayName: "Monitor operator",
        role: Role.MONITOR_OPERATOR,
      },
    });
    console.log("Monitor operator created.");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
