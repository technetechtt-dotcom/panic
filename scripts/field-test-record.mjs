import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((part) => {
    const [key, ...rest] = part.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

const required = ["oem", "model", "android", "scenario", "result"];
for (const key of required) {
  if (!args[key]) {
    console.error(`Missing --${key}=...`);
    process.exit(1);
  }
}
if (!["pass", "fail", "blocked"].includes(String(args.result).toLowerCase())) {
  console.error("--result must be pass|fail|blocked");
  process.exit(1);
}

const out = args.out || join("docs", "FIELD_TEST_RESULTS.md");
mkdirSync(dirname(out), { recursive: true });
const header = `# Field test results\n\nRows are only valid when filled after a physical handset run.\n\n| When | OEM | Model | Android | Scenario | Result | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
if (!existsSync(out) || !readFileSync(out, "utf8").includes("| When | OEM |")) {
  writeFileSync(out, header);
}
const line = `| ${new Date().toISOString()} | ${args.oem} | ${args.model} | ${args.android} | ${args.scenario} | ${args.result} | ${args.notes || ""} |\n`;
appendFileSync(out, line);
console.log(`Recorded ${args.result} for ${args.oem} ${args.model} / ${args.scenario}`);
