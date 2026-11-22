export interface NarrowbandRecord {
  deviceId: string;
  userId: string;
  devicePublicId: string;
  keySeal: string | null;
  iridiumImei: string | null;
  revoked: boolean;
}

export interface NarrowbandStore {
  saveKey(deviceId: string, userId: string, keySeal: string): Promise<boolean>;
  clearKey(deviceId: string, userId: string): Promise<void>;
  findByPublicId(devicePublicId: string): Promise<NarrowbandRecord | null>;
  findByImei(imei: string): Promise<NarrowbandRecord | null>;
  setImei(deviceId: string, userId: string, imei: string): Promise<"saved" | "missing" | "taken">;
}
