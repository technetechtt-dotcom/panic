import { randomBytes } from "node:crypto";
import type { DeviceRegistrationInput } from "@guardian/shared-validation";
import { AppError, UniqueConflictError } from "./errors";
import type { Actor, AuditStore, Clock, DeviceRecord, DeviceStore, IdGenerator } from "./ports";
import { sha256 } from "./security";

export class DeviceService {
  constructor(
    private readonly devices: DeviceStore,
    private readonly audit: AuditStore,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async register(actor: Actor, input: DeviceRegistrationInput, requestId: string | null): Promise<DeviceRecord> {
    const now = this.clock.now();
    const existing = await this.devices.findByPublicId(actor.id, input.devicePublicId);
    if (existing) {
      if (input.publicKey && existing.publicKey && input.publicKey !== existing.publicKey) {
        throw new AppError("DEVICE_KEY_MISMATCH", 409, "This phone's safety key does not match the registered device.");
      }
      if (input.publicKey && !existing.publicKey) {
        existing.publicKey = input.publicKey;
        existing.updatedAt = now;
        await this.devices.save(existing);
      }
      return existing;
    }
    const device: DeviceRecord = {
      id: this.ids.uuid(),
      userId: actor.id,
      devicePublicId: input.devicePublicId,
      platform: "ANDROID",
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      osVersion: input.osVersion,
      appVersion: input.appVersion,
      publicKey: input.publicKey ?? null,
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

  async list(actor: Actor): Promise<DeviceRecord[]> {
    return this.devices.listForUser(actor.id);
  }

  async issueEmergencyCredential(actor: Actor, deviceId: string): Promise<string> {
    const device = await this.devices.findByIdForUser(deviceId, actor.id);
    if (!device) throw new AppError("DEVICE_NOT_FOUND", 404, "Register this device before issuing an emergency credential.");
    const credential = randomBytes(32).toString("base64url");
    const saved = await this.devices.setEmergencyHash(device.id, actor.id, sha256(credential));
    if (!saved) throw new AppError("DEVICE_NOT_FOUND", 404, "Register this device before issuing an emergency credential.");
    return credential;
  }
}
