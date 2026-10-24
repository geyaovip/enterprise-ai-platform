const { execFileSync, spawnSync } = require("node:child_process"),
  { randomBytes } = require("node:crypto"),
  path = require("node:path");
const projectRoot = path.resolve(__dirname, "../../..");
const mode = process.argv[2];
if (
  ![
    "migrate",
    "mes-flow.cjs",
    "mes-ai.cjs",
    "mes-real-model.cjs",
    "erp-ai-efficiency.cjs",
    "ai-usage-efficiency.cjs",
    "runtime-experience-flow.cjs",
    "crm-ai-boundary.cjs",
    "crm-flow.cjs",
    "mes-browser-fixture.cjs",
  ].includes(mode)
)
  throw Error("Unknown local QA command");
const info = JSON.parse(
  execFileSync("docker", ["inspect", "suite-ui-20261020-db"], {
    encoding: "utf8",
  }),
)[0];
if (
  !info.State.Running ||
  info.HostConfig.PortBindings["5432/tcp"][0].HostPort !== "54329"
)
  throw Error("Isolated QA database required");
const cfg = Object.fromEntries(
  info.Config.Env.map((s) => {
    const n = s.indexOf("=");
    return [s.slice(0, n), s.slice(n + 1)];
  }),
);
const u = new URL("postgresql://127.0.0.1:54329/suite_phase1_qa");
u.username = cfg.POSTGRES_USER;
u.password = cfg.POSTGRES_PASSWORD;
const env = {
  ...process.env,
  DATABASE_URL: u.toString(),
  NODE_ENV: "test",
  WEB_ORIGINS: "http://127.0.0.1:4601,http://127.0.0.1:4637",
  MES_AI_RELEASE_ENABLED: "true",
  AI_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CHANNEL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
delete env.RUNTIME_MANAGER_SOCKET;
delete env.AGENT_RUNTIME_PROVIDER;
delete env.MEMORY_CORE_URL;
const args =
  mode === "migrate"
    ? ["node_modules/prisma/build/index.js", "migrate", "deploy"]
    : ["tests/" + mode];
const result = spawnSync(process.execPath, args, {
  cwd: path.join(projectRoot, "apps/api"),
  env,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
