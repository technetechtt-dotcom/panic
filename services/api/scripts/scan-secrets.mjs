import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["openai-project-key", /\bsk-proj-[A-Za-z0-9_-]{30,}\b/],
];
const skip = /^(?:package-lock\.json|docs\/examples\/)|(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const findings = [];
for (const file of files) {
  if (skip.test(file)) continue;
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }
  if (content.includes("\0")) continue;
  for (const [name, pattern] of rules) {
    const match = pattern.exec(content);
    if (match) findings.push({ file, rule: name, line: content.slice(0, match.index).split("\n").length });
  }
}
if (findings.length) {
  console.error("High-confidence secret patterns found:");
  for (const row of findings) console.error(`${row.file}:${row.line} ${row.rule}`);
  process.exit(1);
}
console.log(`Secret scan passed across ${files.length} tracked files.`);
