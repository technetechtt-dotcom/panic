import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface PlatformStatus {
  postgres:string; redis?:string; websocket?:string; sms:string; fcm:string; apns:string; s3:string; vault:string; lastBackup?:string;
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
    ["DATABASE","PostgreSQL",row?.postgres??"unknown"],
    ["REDIS","Redis",row?.redis??"unknown"],
    ["WEBSOCKET","WebSocket",row?.websocket??"unknown"],
    ["SMS","Twilio SMS",row?.sms??"unknown"],
    ["PUSH","Firebase push",row?.fcm??"unknown"],
    ["EMAIL","SMTP email","configured in production gate"],
    ["EVIDENCE","Encrypted evidence vault",row?.vault??"unknown"],
    ["MAPS","Mapping / geocoding","configured by deployment"],
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
    <p className="mt-2 text-sm text-slate-300">Configured is not the same as delivered. Test actions are restricted to supervisors/admins and use explicit test destinations from environment variables.</p>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {items.map(([kind,label,state])=><article key={kind} className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">{label}</h2><p className="mt-1 text-sm text-slate-300">{state}</p></div>
        {canTest?<button type="button" disabled={busy===kind} onClick={()=>void run(kind)} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40">{busy===kind?"Testing…":"Test"}</button>:null}</div>
        {results[kind]?<p className={`mt-3 text-sm ${results[kind].ok?"text-emerald-300":"text-sos"}`} role="status">{results[kind].ok?"PASS":"FAIL"} · {results[kind].detail}</p>:null}
      </article>)}
    </div>
    <section className="mt-6 rounded-2xl border border-line bg-panel p-4 text-sm text-slate-300">
      <h2 className="text-lg font-semibold text-white">Safe test destinations</h2>
      <p className="mt-2">SMS, push and email tests refuse to send unless INTEGRATION_TEST_PHONE, INTEGRATION_TEST_FCM_TOKEN or INTEGRATION_TEST_EMAIL is explicitly configured. Test messages state that no emergency is active.</p>
    </section>
  </main>
}
