import { createHmac, timingSafeEqual } from "node:crypto";

export function deliveryStatusFromTwilio(status: string): "SENT" | "DELIVERED" | "FAILED" {
  const value = status.toLowerCase();
  if (value === "delivered") return "DELIVERED";
  if (value === "failed" || value === "undelivered") return "FAILED";
  return "SENT";
}

export function verifyTwilioSignature(
  url: string,
  body: Record<string, string>,
  signature: string | undefined,
  authToken: string,
): boolean {
  const data = url + Object.keys(body).sort().map((key) => key + body[key]).join("");
  const digest = createHmac("sha1", authToken).update(data).digest("base64");
  const given = Buffer.from(signature ?? "", "utf8");
  const expected = Buffer.from(digest, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
