import { useState, type FormEvent } from "react";
import { authenticate, bindImei, ensureDevice, loadVault, raiseSos, smsHref, uploadPhoto, type SosResult, type Vault } from "./phone";

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [consent, setConsent] = useState(false);
  const [vault, setVault] = useState<Vault | null>(loadVault());
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SosResult | null>(null);
  const [imei, setImei] = useState("");
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const access = await authenticate(mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register", mode === "login"
        ? { email, password }
        : { email, password, displayName, acceptedSafetyConsent: true });
      const device = await ensureDevice(access);
      setToken(access);
      setVault(device.vault);
      setPrivateKey(device.privateKey);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sos() {
    if (!token || !vault || !privateKey) return;
    setBusy(true);
    setError(null);
    setPhotoNote(null);
    try {
      setResult(await raiseSos(token, vault, privateKey));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The SOS was not accepted.");
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file || !token || !result?.incidentId) return;
    setBusy(true);
    setError(null);
    try {
      await uploadPhoto(token, result.incidentId, file);
      setPhotoNote("Photo stored in the evidence vault.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The photo was not stored.");
    } finally {
      setBusy(false);
    }
  }

  async function saveImei() {
    if (!token || !vault) return;
    setBusy(true);
    setError(null);
    try {
      await bindImei(token, vault.deviceId, imei.trim());
      setPhotoNote("Satellite modem bound. It can send the same SOS text with no cell tower.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The modem was not bound.");
    } finally {
      setBusy(false);
    }
  }

  if (!token || !vault) {
    return (
      <main>
        <h1>Guardian</h1>
        <p>This phone signs every SOS. If data fails, it prepares one text message and the same payload for an Iridium modem.</p>
        <form className="stack" onSubmit={(event) => void submitAccount(event)}>
          {mode === "register" ? (
            <label>
              Name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} />
            </label>
          ) : null}
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === "register" ? 12 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>
          {mode === "register" ? (
            <label>
              <span>
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /> I agree that Guardian may receive my location and evidence during an SOS.
              </span>
            </label>
          ) : null}
          <button type="submit" disabled={busy || (mode === "register" && !consent)}>{mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <button type="button" className="secondary" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
          {mode === "login" ? "Create an account" : "I already have an account"}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main>
      <h1>Guardian</h1>
      <p>Hold the button if you need help. A person on the desk has to close the incident.</p>
      <button type="button" className="sos" disabled={busy} onClick={() => void sos()}>
        {busy ? "Sending" : "SOS"}
      </button>
      {result?.path === "DATA" ? <p className="note">SOS is with the desk. Incident {result.incidentId}.</p> : null}
      {result?.path === "SMS" && result.message ? (
        <section className="stack">
          <p className="note">No data reached Guardian. Send this one text now. A bound Iridium modem can send the same text with no cell network.</p>
          <a className="secondary" href={smsHref(result.message)}>Open the SMS</a>
          <p className="frame">{result.message}</p>
        </section>
      ) : null}
      {result?.incidentId ? (
        <label>
          Photo evidence
          <input type="file" accept="image/*" capture="environment" onChange={(event) => void onPhoto(event.target.files?.[0])} />
        </label>
      ) : null}
      <label>
        Iridium modem IMEI
        <input inputMode="numeric" value={imei} onChange={(event) => setImei(event.target.value)} pattern="\d{15}" maxLength={15} placeholder="15 digits" />
      </label>
      <button type="button" className="secondary" disabled={busy || !/^\d{15}$/.test(imei)} onClick={() => void saveImei()}>
        Bind satellite modem
      </button>
      {photoNote ? <p className="note">{photoNote}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
