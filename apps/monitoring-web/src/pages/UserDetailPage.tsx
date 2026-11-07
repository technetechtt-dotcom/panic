import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface UserDetail {
  id:string; email:string; displayName:string; role:string; createdAt:string; lastLoginAt:string|null; suspendedAt:string|null; emailVerifiedAt:string|null;
  mfaEnabled:boolean; unusedMfaRecoveryCodes:number;
  devices:Array<{id:string;nickname:string|null;model:string|null;platform:string;osVersion:string;appVersion:string;revokedAt:string|null;lastSeenAt:string|null;pushReady:boolean;emergencyCredentialProvisioned:boolean}>;
  sessions:Array<{id:string;familyId:string;createdAt:string;expiresAt:string;revokedAt:string|null}>;
}
export function UserDetailPage(){
 const {id=""}=useParams(); const {session}=useAuth(); const token=session?.accessToken??null; const qc=useQueryClient();
 const user=useQuery({queryKey:["admin-user",id],queryFn:()=>api<UserDetail>(`/api/v1/admin/users/${id}`,token)});
 async function action(name:"suspend"|"reactivate"|"revoke-sessions"|"reset-mfa"){
   await api(`/api/v1/admin/users/${id}/${name}`,token,{method:"POST",body:JSON.stringify({})});
   await Promise.all([qc.invalidateQueries({queryKey:["admin-user",id]}),qc.invalidateQueries({queryKey:["admin-users"]})]);
 }
 const row=user.data;
 return <main className="mx-auto max-w-5xl px-4 py-6">
   <Link to="/people" className="text-sm underline">Back to people</Link>
   <h1 className="mt-4 text-3xl font-semibold">{row?.displayName??"Account"}</h1>
   {row?<><p className="mt-1 text-sm text-slate-300">{row.email} · {row.role}</p>
   <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
     <Card label="Account" value={row.suspendedAt?"SUSPENDED":"ACTIVE"}/><Card label="MFA" value={row.mfaEnabled?`ENABLED · ${row.unusedMfaRecoveryCodes} recovery`:"NOT ENABLED"}/><Card label="Last login" value={row.lastLoginAt?new Date(row.lastLoginAt).toLocaleString():"never"}/><Card label="Email" value={row.emailVerifiedAt?"VERIFIED":"UNVERIFIED"}/>
   </section>
   {row.id!==session?.user.id?<div className="mt-5 flex flex-wrap gap-2">
     <button className="rounded-lg border border-line px-3 py-2" onClick={()=>void action(row.suspendedAt?"reactivate":"suspend")}>{row.suspendedAt?"Reactivate account":"Suspend account"}</button>
     <button className="rounded-lg border border-line px-3 py-2" onClick={()=>void action("revoke-sessions")}>Revoke all sign-in sessions</button>
     <button className="rounded-lg border border-line px-3 py-2" onClick={()=>void action("reset-mfa")}>Reset MFA</button>
   </div>:<p className="mt-5 text-sm text-slate-400">Self-service security changes are handled from Security; destructive admin actions are disabled for your own account.</p>}
   <section className="mt-7"><h2 className="text-xl font-semibold">Devices</h2><div className="mt-3 space-y-2">{row.devices.map(d=><article key={d.id} className="rounded-xl border border-line bg-panel p-3 text-sm"><strong>{d.nickname??d.model??"Device"}</strong><p className="text-slate-300">{d.platform} · {d.osVersion} · app {d.appVersion}</p><p className="text-xs text-slate-400">Last seen {d.lastSeenAt?new Date(d.lastSeenAt).toLocaleString():"unknown"} · push {d.pushReady?"ready":"not ready"} · emergency credential {d.emergencyCredentialProvisioned?"provisioned":"none"} · {d.revokedAt?"REVOKED":"active"}</p></article>)}</div></section>
   <section className="mt-7"><h2 className="text-xl font-semibold">Sign-in sessions</h2><div className="mt-3 space-y-2">{row.sessions.map(s=><article key={s.id} className="rounded-xl border border-line bg-panel p-3 text-sm"><p>Created {new Date(s.createdAt).toLocaleString()} · expires {new Date(s.expiresAt).toLocaleString()}</p><p className="text-xs text-slate-400">{s.revokedAt?`Revoked ${new Date(s.revokedAt).toLocaleString()}`:"Active refresh token record"}</p></article>)}</div></section>
   </>:null}
   {user.isError?<p className="mt-5 text-sos">Account detail could not be loaded.</p>:null}
 </main>
}
function Card({label,value}:{label:string;value:string}){return <article className="rounded-2xl border border-line bg-panel p-4"><p className="text-xs uppercase text-slate-400">{label}</p><p className="mt-2 font-semibold">{value}</p></article>}
