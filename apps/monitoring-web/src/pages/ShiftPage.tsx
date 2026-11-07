import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Shift { id:string; operatorId:string; status:string; startedAt:string; readyAt:string|null; handoverNote:string|null; handoverToId:string|null }
interface Operator { id:string; displayName:string; email:string; role:string; shiftStatus:string; shiftStartedAt:string|null }
interface Platform { postgres:string; redis?:string; websocket?:string; sms:string; fcm:string; apns:string }

export function ShiftPage(){
  const {session}=useAuth(); const token=session?.accessToken??null; const qc=useQueryClient();
  const [audioReady,setAudioReady]=useState(false);
  const [notificationReady,setNotificationReady]=useState(typeof Notification!=="undefined"&&Notification.permission==="granted");
  const [note,setNote]=useState(""); const [receiver,setReceiver]=useState(""); const [error,setError]=useState<string|null>(null);
  const shift=useQuery({queryKey:["shift"],queryFn:()=>api<Shift|null>("/api/v1/operators/shifts/current",token),refetchInterval:10000});
  const operators=useQuery({queryKey:["operators"],queryFn:()=>api<Operator[]>("/api/v1/operators",token),refetchInterval:15000});
  const platform=useQuery({queryKey:["platform"],queryFn:()=>api<Platform>("/api/v1/admin/platform",token),refetchInterval:10000});
  const coreReady=Boolean(platform.data?.postgres==="up"&&platform.data?.redis==="up"&&(platform.data?.websocket??"").includes("up"));
  const sessionReady=Boolean(session?.accessToken);
  const ready=audioReady&&notificationReady&&coreReady&&sessionReady;
  const receiverOptions=useMemo(()=> (operators.data??[]).filter(x=>x.id!==session?.user.id),[operators.data,session?.user.id]);

  async function action(path:string,body:Record<string,string>={}){
    setError(null);
    try{await api(path,token,{method:"POST",body:JSON.stringify(body)});await Promise.all([qc.invalidateQueries({queryKey:["shift"]}),qc.invalidateQueries({queryKey:["operators"]})]);}
    catch(e){setError(e instanceof Error?e.message:"Shift action failed.");}
  }
  async function requestNotifications(){
    if(typeof Notification==="undefined"){setError("This browser does not expose notifications.");return;}
    const permission=await Notification.requestPermission(); setNotificationReady(permission==="granted");
  }
  async function testAudio(){
    try{
      const AudioCtor=window.AudioContext || (window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
      const ctx=new AudioCtor(); const osc=ctx.createOscillator(); const gain=ctx.createGain();
      gain.gain.value=0.08; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+0.2);
      await ctx.resume(); setAudioReady(true); window.setTimeout(()=>void ctx.close(),500);
    }catch{setAudioReady(false);setError("Browser audio could not be armed. Interact with the page and try again.");}
  }
  function handover(e:FormEvent){e.preventDefault();if(!receiver){setError("Choose the receiving operator.");return;}void action("/api/v1/operators/shifts/handover",{note,handoverToId:receiver});}

  return <main className="mx-auto max-w-5xl px-4 py-6">
    <h1 className="text-3xl font-semibold">Shift Readiness & Handover</h1>
    <p className="mt-2 text-sm text-slate-300">A monitoring shift is not ready until alert audio, browser notifications, session and core realtime services have been checked.</p>
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Check label="Alert audio" ok={audioReady} detail={audioReady?"armed":"test required"} action={<button className="underline" onClick={()=>void testAudio()}>Test audio</button>}/>
      <Check label="Browser notifications" ok={notificationReady} detail={notificationReady?"granted":"permission required"} action={<button className="underline" onClick={()=>void requestNotifications()}>Enable</button>}/>
      <Check label="API / Redis / realtime" ok={coreReady} detail={`${platform.data?.postgres??"?"} · ${platform.data?.redis??"?"} · ${platform.data?.websocket??"?"}`}/>
      <Check label="Operator session" ok={sessionReady} detail={session?.user.email??"not signed in"}/>
    </section>
    <section className="mt-6 rounded-2xl border border-line bg-panel p-4">
      <h2 className="text-xl font-semibold">Current shift</h2>
      <p className="mt-2 text-sm text-slate-300">{shift.data?`${shift.data.status} since ${new Date(shift.data.startedAt).toLocaleString()}`:"No open shift."}</p>
      {shift.data?.handoverNote?<p className="mt-2 rounded-lg border border-line p-3 text-sm">Incoming handover: {shift.data.handoverNote}</p>:null}
      <div className="mt-4 flex flex-wrap gap-2">
        {!shift.data?<button className="rounded-lg border border-line px-3 py-2" onClick={()=>void action("/api/v1/operators/shifts/start")}>Start shift</button>:null}
        {shift.data?<button disabled={!ready} className="rounded-lg bg-warn px-3 py-2 font-semibold text-ink disabled:opacity-40" onClick={()=>void action("/api/v1/operators/shifts/ready")}>Acknowledge handover / mark ready</button>:null}
      </div>
      {!ready?<p className="mt-2 text-xs text-slate-400">Resolve the failed readiness checks before marking ready.</p>:null}
    </section>
    {shift.data?<form onSubmit={handover} className="mt-6 rounded-2xl border border-line bg-panel p-4">
      <h2 className="text-xl font-semibold">Hand over shift</h2>
      <label className="mt-3 block text-sm">Receiving operator
        <select value={receiver} onChange={e=>setReceiver(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2">
          <option value="">Select operator</option>{receiverOptions.map(x=><option key={x.id} value={x.id}>{x.displayName} · {x.role} · {x.shiftStatus}</option>)}
        </select>
      </label>
      <label className="mt-3 block text-sm">Handover note
        <textarea required value={note} onChange={e=>setNote(e.target.value)} className="mt-1 min-h-28 w-full rounded-lg border border-line bg-ink px-3 py-2" placeholder="Open incidents, responder movements, provider issues, actions still needed"/>
      </label>
      <button type="submit" className="mt-3 rounded-lg border border-line px-3 py-2">Hand over to selected operator</button>
    </form>:null}
    <section className="mt-6 rounded-2xl border border-line bg-panel p-4 text-sm"><h2 className="text-lg font-semibold">Provider readiness</h2><p className="mt-2 text-slate-300">SMS {platform.data?.sms??"?"} · FCM {platform.data?.fcm??"?"} · APNs {platform.data?.apns??"?"}. Provider configuration is visible here but does not itself prove device delivery.</p></section>
    {error?<p className="mt-4 text-sos" role="alert">{error}</p>:null}
  </main>
}
function Check({label,ok,detail,action}:{label:string;ok:boolean;detail:string;action?:React.ReactNode}){return <article className="rounded-2xl border border-line bg-panel p-4"><p className="text-sm text-slate-300">{label}</p><p className="mt-2 text-xl font-semibold">{ok?"READY":"NOT READY"}</p><p className="mt-1 text-xs text-slate-400">{detail}</p>{action?<div className="mt-2 text-sm">{action}</div>:null}</article>}
