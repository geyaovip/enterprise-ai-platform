const baseAssert = require("node:assert/strict"),
  http = require("node:http"),
  {
    SeedreamProvider,
    MediaError,
  } = require("../dist/modules/content/seedream.provider"),
  { mediaOperation } = require("../dist/modules/content/content-storage");
let checks = 0;
const assert = new Proxy(baseAssert, {
  get(target, key) {
    const value = target[key];
    return typeof value === "function"
      ? (...args) => {
          checks++;
          return Reflect.apply(value, target, args);
        }
      : value;
  },
});
let calls = 0,
  code = 200,
  body;
const server = http.createServer(async (req, res) => {
  calls++;
  let raw = "";
  for await (const b of req) raw += b;
  body = JSON.parse(raw);
  assert.equal(req.url, "/api/v3/images/generations");
  assert.equal(req.headers.authorization, "Bearer fake-local-only");
  res.writeHead(code, { "content-type": "application/json" });
  res.end(
    JSON.stringify(
      code === 200
        ? {
            data: [{ b64_json: Buffer.from("test").toString("base64") }],
            usage: { generated_images: 1 },
          }
        : { error: { code: "synthetic" } },
    ),
  );
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.NODE_ENV = "test";
  process.env.CONTENT_ARK_BASE_URL =
    "http://127.0.0.1:" + server.address().port + "/api/v3";
  process.env.CONTENT_ARK_API_KEY = "fake-local-only";
  const p = new SeedreamProvider();
  assert.ok(p.configured());
  const binding = p.binding();
  assert.equal(binding.purpose, "content.image");
  assert.ok(!JSON.stringify(binding).includes("fake-local-only"));
  await assert.rejects(
    () => p.generate("背景", "local-stale", undefined, "outdated-binding"),
    (e) => e.code === "CONTENT_MODEL_BINDING_CHANGED" && e.definitive,
  );
  assert.equal(calls, 0);
  const r = await p.generate("背景", "local-1");
  assert.equal(r.usage.generated_images, 1);
  assert.equal(body.model, "doubao-seedream-4-5-251128");
  assert.equal(body.response_format, "b64_json");
  assert.equal(body.sequential_image_generation, "disabled");
  assert.equal(body.size, "2K");
  assert.equal(body.watermark, false);
  code = 500;
  await assert.rejects(
    () => p.generate("背景", "local-2"),
    (e) => e.code === "CONTENT_PROVIDER_HTTP_500" && !e.definitive,
  );
  assert.equal(calls, 2);
  code = 429;
  await assert.rejects(
    () => p.generate("背景", "local-3"),
    (e) => e.definitive,
  );
  assert.equal(calls, 3);
  process.env.CONTENT_ARK_BASE_URL = "https://example.test/api/v3";
  assert.equal(p.configured(), false);
  console.log(
    JSON.stringify({
      ok: true,
      checks,
      localHttpRequests: calls,
      paidRequests: 0,
    }),
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => server.close());
