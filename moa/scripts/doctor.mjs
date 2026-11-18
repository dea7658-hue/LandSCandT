import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deploy = process.argv.includes("--deploy");
let failures = 0;
function report(ok, title, help, required = true) {
  console.log(
    `${ok ? "✓" : required ? "✗" : "△"} ${title}${!ok && help ? "\n  → " + help : ""}`,
  );
  if (!ok && required) failures++;
}
const version = process.versions.node.split(".").map(Number);
report(
  version[0] >= 24 || (version[0] === 22 && version[1] >= 12),
  "Node.js 22.12 이상 또는 24 이상",
  "Node.js LTS를 설치해주세요.",
);
report(
  existsSync(resolve(root, "node_modules/.bin/vite")),
  "의존성 설치",
  "프로젝트 폴더에서 npm ci를 실행해주세요.",
);
const configPath = resolve(root, "wrangler.toml");
const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
report(!!config, "Cloudflare 설정 파일", "wrangler.toml 파일을 복구해주세요.");
const id = config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
report(
  !!id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  "실제 D1 database_id",
  "npx wrangler d1 create compass 결과의 ID를 wrangler.toml에 넣으세요. 로컬 개발에는 임시 ID도 사용 가능합니다.",
  deploy,
);
report(
  /binding\s*=\s*"PHOTOS"/.test(config) &&
    /bucket_name\s*=\s*"[^"\n]+"/.test(config),
  "사진 저장소 바인딩",
  "PHOTOS 바인딩과 R2 bucket_name을 확인해주세요.",
);
let envFile = "";
for (const name of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
]) {
  if (existsSync(resolve(root, name)))
    envFile += "\n" + readFileSync(resolve(root, name), "utf8");
}
const matches = [
  ...envFile.matchAll(/^\s*VITE_GOOGLE_MAPS_API_KEY\s*=\s*([^\r\n]*)/gm),
];
const value =
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  matches
    .at(-1)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, "");
report(
  !!value && !/^(YOUR_|REPLACE_|여기에)/i.test(value),
  "Google Maps 브라우저 키",
  ".env.local에 VITE_GOOGLE_MAPS_API_KEY를 설정하세요. 키 없이 목록·공유·사진 개발을 먼저 할 수 있습니다.",
  deploy,
);
console.log("\nAPI 키·초대 코드·관리 키는 출력하지 않았습니다.");
console.log(
  "실제 Cloudflare 로그인·원격 자원 존재·Google API 활성화/결제/키 제한은 이 명령으로 확인하지 않습니다. SETUP.md를 따라 준비하세요.",
);
process.exitCode = failures ? 1 : 0;
