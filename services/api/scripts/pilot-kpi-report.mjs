import { PrismaClient } from "@prisma/client";

const prisma=new PrismaClient();
const sinceArg=process.argv.find((value)=>value.startsWith("--since="));
const since=sinceArg?new Date(sinceArg.slice("--since=".length)):null;
if(since && Number.isNaN(since.getTime())) throw new Error("Invalid --since ISO date.");

const ms=(start,end)=>end?end.getTime()-start.getTime():null;
const seconds=(value)=>value==null?null:Math.round(value/10)/100;
const firstDate=(dates)=>dates.filter(Boolean).sort((a,b)=>a.getTime()-b.getTime())[0]??null;
function stats(values){
  const sorted=values.filter((v)=>Number.isFinite(v)).sort((a,b)=>a-b);
  const percentile=(p)=>sorted.length?sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1))]:null;
  return {
    samples:sorted.length,
    min:seconds(sorted[0]??null),
    p50:seconds(percentile(0.50)),
    p95:seconds(percentile(0.95)),
    p99:seconds(percentile(0.99)),
    max:seconds(sorted.at(-1)??null),
  };
}
try{
  const incidents=await prisma.incident.findMany({
    where:{isTest:true,...(since?{createdAt:{gte:since}}:{})},
    include:{deliveries:true,assignments:true},
    orderBy:{createdAt:"asc"},
  });
  const ack=[],guardianSent=[],guardianDelivered=[],guardianAck=[],dispatch=[],accept=[],arrival=[],resolution=[];
  for(const row of incidents){
    const start=row.createdAt;
    const deliveries=row.deliveries.filter((d)=>["SMS","FCM","APNS","ROOM"].includes(d.channel));
    const sent=firstDate(deliveries.map((d)=>d.sentAt));
    const delivered=firstDate(deliveries.map((d)=>d.deliveredAt));
    const acknowledged=firstDate(deliveries.map((d)=>d.acknowledgedAt));
    const assigned=firstDate(row.assignments.map((a)=>a.assignedAt));
    const accepted=firstDate(row.assignments.map((a)=>a.acceptedAt));
    const arrived=firstDate(row.assignments.map((a)=>a.arrivedAt));
    const values=[
      [ack,ms(start,row.acknowledgedAt)],
      [guardianSent,ms(start,sent)],
      [guardianDelivered,ms(start,delivered)],
      [guardianAck,ms(start,acknowledged)],
      [dispatch,ms(start,assigned)],
      [accept,ms(start,accepted)],
      [arrival,ms(start,arrived)],
      [resolution,ms(start,row.resolvedAt)],
    ];
    for(const [target,value] of values) if(value!=null && value>=0) target.push(value);
  }
  const report={
    generatedAt:new Date().toISOString(),
    source:"Guardian TEST incidents only",
    since:since?.toISOString()??null,
    incidents:incidents.length,
    note:"Times are server-recorded workflow timings. They do not measure phone-local trigger latency or offline queue duration unless those timestamps are separately correlated.",
    seconds:{
      sosToOperatorAcknowledgement:stats(ack),
      sosToGuardianProviderSubmission:stats(guardianSent),
      sosToGuardianDeliveryReceipt:stats(guardianDelivered),
      sosToGuardianAcknowledgement:stats(guardianAck),
      sosToResponderDispatch:stats(dispatch),
      sosToResponderAcceptance:stats(accept),
      sosToResponderArrival:stats(arrival),
      sosToResolution:stats(resolution),
    },
  };
  console.log(JSON.stringify(report,null,2));
}finally{
  await prisma.$disconnect();
}
