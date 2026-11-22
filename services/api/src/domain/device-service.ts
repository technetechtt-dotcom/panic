import { randomBytes } from "node:crypto";
import type { DeviceRegistrationInput } from "@guardian/shared-validation";
import { AppError, UniqueConflictError } from "./errors";
import type { NarrowbandStore } from "./narrowband-store";
import type { Actor, AuditStore, Clock, DeviceRecord, DeviceStore, IdGenerator } from "./ports";
import { sealSecret, sha256 } from "./security";

export class DeviceService {
  constructor(
    private readonly devices: DeviceStore,
    private readonly audit: AuditStore,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly channels: NarrowbandStore | null = null,
    private readonly sealKey = "",
  ) {}

  async register(actor: Actor, input: DeviceRegistrationInput, requestId: string | null): Promise<DeviceRecord> {
    const now = this.clock.now();
    const existing = await this.devices.findByPublicId(actor.id, input.devicePublicId);
    if (existing) {
      if (input.publicKey && existing.publicKey && input.publicKey !== existing.publicKey) {
        throw new AppError("DEVICE_KEY_MISMATCH", 409, "This phone's safety key does not match the registered device.");
      }
      let dirty = false;
      if (input.publicKey && !existing.publicKey) {
        existing.publicKey = input.publicKey;
        dirty = true;
      }
      if (input.fcmToken && input.fcmToken !== existing.fcmToken) {
        existing.fcmToken = input.fcmToken;
        existing.pushTokenUpdatedAt = now;
        dirty = true;
      }
      if (existing.revokedAt) {
        existing.revokedAt = null;
        dirty = true;
      }
      existing.lastSeenAt = now;
      if (dirty) {
        existing.updatedAt = now;
      }
      await this.devices.save(existing);
      return existing;
    }
    const device: DeviceRecord = {
      id: this.ids.uuid(),
      userId: actor.id,
      devicePublicId: input.devicePublicId,
      platform: input.platform,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      osVersion: input.osVersion,
      appVersion: input.appVersion,
      publicKey: input.publicKey ?? null,
      fcmToken: input.fcmToken ?? null,
      revokedAt: null,
      lastSeenAt: now,
      pushTokenUpdatedAt: input.fcmToken ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.devices.insert(device);
    } catch (error) {
      if (error instanceof UniqueConflictError) {
        const raced = await this.devices.findByPublicId(actor.id, input.devicePublicId);
        if (raced) return raced;
      }
      throw error;
    }
    await this.audit.append({
      id: this.ids.uuid(),
      actorId: actor.id,
      action: "device.registered",
      entityType: "Device",
      entityId: device.id,
      correlationId: null,
      requestId,
      metadata: { platform: device.platform },
      createdAt: now,
    });
    return device;
  }

  async list(actor: Actor) {
    const rows = await this.devices.listForUser(actor.id);
    return rows.map((row) => ({
      id: row.id,
      devicePublicId: row.devicePublicId,
      platform: row.platform,
      manufacturer: row.manufacturer,
      model: row.model,
      osVersion: row.osVersion,
      appVersion: row.appVersion,
      revokedAt: row.revokedAt,
      lastSeenAt: row.lastSeenAt,
      nickname: row.nickname,
      fcmToken: row.fcmToken,
      emergencyCredentialProvisioned: row.emergencyCredentialProvisioned === true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async revoke(actor: Actor, deviceId: string, requestId: string | null): Promise<void> {
    const device = await this.devices.findByIdForUser(deviceId, actor.id);
    if (!device) throw new AppError("DEVICE_NOT_FOUND", 404, "That device was not found.");
    const now = this.clock.now();
    device.revokedAt = now;
    device.fcmToken = null;
    device.updatedAt = now;
    await this.devices.save(device);
    await this.devices.setEmergencyHash(device.id, actor.id, "");
    await this.channels?.clearKey(device.id, actor.id);
    await this.audit.append({
      id: this.ids.uuid(),
      actorId: actor.id,
      action: "device.revoked",
      entityType: "Device",
      entityId: device.id,
      correlationId: null,
      requestId,
      metadata: { devicePublicId: device.devicePublicId },
      createdAt: now,
    });
  }

  async issueEmergencyCredential(actor: Actor, deviceId: string): Promise<string> {
    const device = await this.devices.findByIdForUser(deviceId, actor.id);
    if (!device) throw new AppError("DEVICE_NOT_FOUND", 404, "Register this device before issuing an emergency credential.");
    const credential = randomBytes(32).toString("base64url");
    const saved = await this.devices.setEmergencyHash(device.id, actor.id, sha256(credential));
    if (!saved) throw new AppError("DEVICE_NOT_FOUND", 404, "Register this device before issuing an emergency credential.");
    if (this.channels) {
      if (this.sealKey.length < 32) {
        throw new AppError("NOT_CONFIGURED", 503, "The narrowband key cannot be stored until the encryption key is configured.");
      }
      const keyed = await this.channels.saveKey(device.id, actor.id, sealSecret(credential, this.sealKey));
      if (!keyed) throw new AppError("DEVICE_NOT_FOUND", 404, "Register this device before issuing an emergency credential.");
    }
    return credential;
  }

  async bindImei(actor: Actor, deviceId: string, imei: string): Promise<{ deviceId: string; imei: string }> {
    if (!this.channels) throw new AppError("NOT_CONFIGURED", 503, "Satellite binding is not available.");
    const device = await this.devices.findByIdForUser(deviceId, actor.id);
    if (!device || device.revokedAt) throw new AppError("DEVICE_NOT_FOUND", 404, "Register this device before binding a satellite modem.");
    const result = await this.channels.setImei(device.id, actor.id, imei);
    if (result === "missing") throw new AppError("DEVICE_NOT_FOUND", 404, "Register this device before binding a satellite modem.");
    if (result === "taken") throw new AppError("IMEI_IN_USE", 409, "That satellite modem is already bound to another device.");
    return { deviceId: device.id, imei };
  }
}
