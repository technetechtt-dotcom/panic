import { readFileSync } from "node:fs";

const file=process.argv[2];
if(!file){
  console.error("Usage: node services/api/scripts/safe-word-benchmark.mjs <results.jsonl>");
  process.exit(1);
}
const rows=readFileSync(file,"utf8").split(/\r?\n/).filter(Boolean).map((line,index)=>{
  try{return JSON.parse(line);}catch{throw new Error(`Invalid JSON on line ${index+1}`);}
});
if(!rows.length) throw new Error("No benchmark rows.");
for(const row of rows){
  if(typeof row.expected!=="boolean"||typeof row.detected!=="boolean") throw new Error("Each row needs boolean expected and detected.");
}
function metrics(items){
  let tp=0,tn=0,fp=0,fn=0;
  for(const row of items){
    if(row.expected&&row.detected)tp++;
    else if(!row.expected&&!row.detected)tn++;
    else if(!row.expected&&row.detected)fp++;
    else fn++;
  }
  const positives=tp+fn, negatives=tn+fp;
  const precision=tp+fp?tp/(tp+fp):null;
  const recall=positives?tp/positives:null;
  return {
    samples:items.length,tp,tn,fp,fn,
    falseAcceptanceRate:negatives?fp/negatives:null,
    falseRejectionRate:positives?fn/positives:null,
    precision,recall,
  };
}
function groups(field){
  const map=new Map();
  for(const row of rows){
    const key=String(row[field]??"unspecified");
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(row);
  }
  return Object.fromEntries([...map].sort(([a],[b])=>a.localeCompare(b)).map(([key,items])=>[key,metrics(items)]));
}
const report={
  generatedAt:new Date().toISOString(),
  note:"Metrics describe only the supplied labelled field-test samples. They are not a medical or universal accuracy claim.",
  overall:metrics(rows),
  byDevice:groups("device"),
  byLanguage:groups("language"),
  byCondition:groups("condition"),
  byNoise:groups("noise"),
};
console.log(JSON.stringify(report,null,2));
