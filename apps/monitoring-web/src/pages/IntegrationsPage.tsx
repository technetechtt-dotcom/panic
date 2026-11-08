import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface ProviderTelemetry { lastSuccessAt:string|null; lastFailureAt:string|null }
interface PlatformStatus {
  postgres:string; redis?:string; websocket?:string; sms:string; fcm:string; apns:string; smtp?:string; maps?:string;
  s3:string; vault:string; lastBackup?:string; providerTelemetry?:Record<string,ProviderTelemetry>;
}
interface TestResult { kind:string; ok:boolean; detail:string }

export function IntegrationsPage(){
  const {session}=useAuth(); const token=session?.accessToken??null;
  const canTest=session?.user.role==="ADMIN"||session?.user.role==="SUPERVISOR";
  const [results,setResults]=useState<Record<string,TestResult>>({});
  const [busy,setBusy]=useState<string|null>(null);
  const status=useQuery({queryKey:["platform"],queryFn:()=>api<PlatformStatus>("/api/v1/admin/platform",token),refetchInterval:15000});
  const row=status.data;
  const items=[
    ["DATABASE","PostgreSQL",row?.postgres??"unknown",null],
    ["REDIS","Redis",row?.redis??"unknown",null],
    ["WEBSOCKET","WebSocket",row?.websocket??"unknown",null],
    ["SMS","Twilio SMS",row?.sms??"unknown",row?.providerTelemetry?.SMS],
    ["PUSH","Firebase push",row?.fcm??"unknown",row?.providerTelemetry?.FCM],
    ["EMAIL","SMTP email",row?.smtp??"unknown",row?.providerTelemetry?.EMAIL],
    ["EVIDENCE","Encrypted local + remote evidence storage",`${row?.vault??"unknown"} · remote ${row?.s3??"unknown"}`,null],
    ["MAPS","Geocoding + tile delivery",row?.maps??"unknown",null],
  ] as const;
  async function run(kind:string){
    setBusy(kind);
    try{
      const result=await api<TestResult>(`/api/v1/admin/integrations/${kind.toLowerCase()}/test`,token,{method:"POST",body:JSON.stringify({})});
      setResults(current=>({...current,[kind]:result}));
    }catch(error){setResults(current=>({...current,[kind]:{kind,ok:false,detail:error instanceof Error?error.message:"Test failed."}}));}
    finally{setBusy(null);}
  }
  return <main className="mx-auto max-w-5xl px-4 py-6">
    <h1 className="text-3xl font-semibold">Integrations</h1>
    <p className="mt-2 text-sm text-slate-300">Configuration is not proof of delivery. Health probes verify live dependencies where a safe test can be performed.</p>
    {status.isError?<p role="alert" className="mt-4 text-sos">Platform integration status could not be loaded.</p>:null}
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {items.map(([kind,label,state,telemetry])=><article key={kind} className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">{label}</h2><p className="mt-1 text-sm text-slate-300">{state}</p>
        {telemetry?<p className="mt-1 text-xs text-slate-400">Last success {telemetry.lastSuccessAt?new Date(telemetry.lastSuccessAt).toLocaleString():"not recorded"} · last failure {telemetry.lastFailureAt?new Date(telemetry.lastFailureAt).toLocaleString():"not recorded"}</p>:null}</div>
        {canTest?<button type="button" disabled={busy===kind} onClick={()=>void run(kind)} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40">{busy===kind?"Testing…":"Test"}</button>:null}</div>
        {results[kind]?<p className={`mt-3 text-sm ${results[kind].ok?"text-emerald-300":"text-sos"}`} role="status">{results[kind].ok?"PASS":"FAIL"} · {results[kind].detail}</p>:null}
      </article>)}
    </div>
    <section className="mt-6 rounded-2xl border border-line bg-panel p-4 text-sm text-slate-300">
      <h2 className="text-lg font-semibold text-white">Safe test destinations</h2>
      <p className="mt-2">SMS, push and email tests refuse to send unless their explicit integration-test destination is configured. Evidence tests perform encrypted local and configured remote object-store round trips. Maps verifies both geocoding and MAP_TILE_HEALTH_URL.</p>
    </section>
  </main>
}
