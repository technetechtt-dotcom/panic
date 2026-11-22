import type { PrismaClient } from "@prisma/client";
import type { NarrowbandRecord, NarrowbandStore } from "../domain/narrowband-store";

export class PrismaNarrowbandStore implements NarrowbandStore {
  constructor(private readonly prisma: PrismaClient) {}

  async saveKey(deviceId: string, userId: string, keySeal: string): Promise<boolean> {
    const updated = await this.prisma.device.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { narrowbandKeySeal: keySeal },
    });
    return updated.count === 1;
  }

  async clearKey(deviceId: string, userId: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: { id: deviceId, userId },
      data: { narrowbandKeySeal: null, iridiumImei: null },
    });
  }

  async findByPublicId(devicePublicId: string): Promise<NarrowbandRecord | null> {
    const row = await this.prisma.device.findFirst({
      where: { devicePublicId, revokedAt: null },
      select: { id: true, userId: true, devicePublicId: true, narrowbandKeySeal: true, iridiumImei: true, revokedAt: true },
    });
    return row ? toRecord(row) : null;
  }

  async findByImei(imei: string): Promise<NarrowbandRecord | null> {
    const row = await this.prisma.device.findFirst({
      where: { iridiumImei: imei, revokedAt: null },
      select: { id: true, userId: true, devicePublicId: true, narrowbandKeySeal: true, iridiumImei: true, revokedAt: true },
    });
    return row ? toRecord(row) : null;
  }

  async setImei(deviceId: string, userId: string, imei: string): Promise<"saved" | "missing" | "taken"> {
    const taken = await this.prisma.device.findFirst({
      where: { iridiumImei: imei, NOT: { id: deviceId } },
      select: { id: true },
    });
    if (taken) return "taken";
    const updated = await this.prisma.device.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { iridiumImei: imei },
    });
    return updated.count === 1 ? "saved" : "missing";
  }
}

function toRecord(row: {
  id: string;
  userId: string;
  devicePublicId: string;
  narrowbandKeySeal: string | null;
  iridiumImei: string | null;
  revokedAt: Date | null;
}): NarrowbandRecord {
  return {
    deviceId: row.id,
    userId: row.userId,
    devicePublicId: row.devicePublicId,
    keySeal: row.narrowbandKeySeal,
    iridiumImei: row.iridiumImei,
    revoked: Boolean(row.revokedAt),
  };
}
