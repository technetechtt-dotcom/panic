import type { DeviceRegistrationInput } from "@guardian/shared-validation";
import { UniqueConflictError } from "./errors";
import type { Actor, AuditStore, Clock, DeviceRecord, DeviceStore, IdGenerator } from "./ports";

export class DeviceService {
  constructor(
    private readonly devices: DeviceStore,
    private readonly audit: AuditStore,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async register(actor: Actor, input: DeviceRegistrationInput, requestId: string | null): Promise<DeviceRecord> {
    const existing = await this.devices.findByPublicId(actor.id, input.devicePublicId);
    if (existing) return existing;
    const now = this.clock.now();
    const device: DeviceRecord = {
      id: this.ids.uuid(),
      userId: actor.id,
      devicePublicId: input.devicePublicId,
      platform: "ANDROID",
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      osVersion: input.osVersion,
      appVersion: input.appVersion,
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
}
