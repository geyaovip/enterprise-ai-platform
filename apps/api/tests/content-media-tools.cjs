const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createApp } = require("../dist/server");
const { PrismaService } = require("../dist/modules/prisma.service");
const { ContentService } = require("../dist/modules/content/content.service");
const { ContentMediaToolsService } = require("../dist/modules/content/content-media-tools.service");
const { ModelGateway } = require("../dist/modules/ai/model.gateway");
const { AuthService } = require("../dist/modules/platform/auth.service");
const { createFixture, fixtureHttp, cleanupFixture } = require("../scripts/workflow-fixture.cjs");

assert.equal(process.env.NODE_ENV, "test");
assert.match(process.env.DATABASE_URL ?? "", /@127\.0\.0\.1:54329\/suite_phase1_qa$/);
const ffmpeg = process.env.CONTENT_FFMPEG_PATH ?? "ffmpeg";
const ffprobe = process.env.CONTENT_FFPROBE_PATH ?? "ffprobe";
const tmp = mkdtempSync(join(tmpdir(), "content-media-tools-qa-"));
const readySrt = "1\n00:00:00,100 --> 00:00:01,400\n欢迎观看\n";
const gen = (args) => execFileSync(ffmpeg, ["-nostdin", "-v", "error", "-threads", "1", ...args]);
async function readChunks(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
const run = async () => {
  gen(["-f", "lavfi", "-i", "color=c=blue:s=320x240:r=15:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=2", "-c:v", "libx264", "-c:a", "aac",
    "-threads", "1", join(tmp, "video.mp4")]);
  gen(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=1.5", "-threads", "1", join(tmp, "audio.mp3")]);
  gen(["-i", join(tmp, "video.mp4"), "-frames:v", "1", "-threads", "1", join(tmp, "face.png")]);
  const video = readFileSync(join(tmp, "video.mp4"));
  const audio = readFileSync(join(tmp, "audio.mp3"));
  const face = readFileSync(join(tmp, "face.png"));
  const upstreamCalls = [];
  const receivedFiles = new Set();
  const jobsByToken = new Map();
  const upstreamJobs = new Map();
  let failVoice = false;
  let failFirstFace = true;
  let stubFailure;
  let translationCalls = 0;
  const mock = createServer(async (req, res) => {
    const json = (body, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const path = req.url;
    const bytes = Buffer.concat(await readChunks(req));
    try {
      if (path === "/api/tools-sync/request-media-upload-url") {
        assert.equal(req.headers.authorization, "Bearer isolated-media-kit");
        const id = randomUUID();
        return json({ success: true, result: { file_id: "mediakit://qa/" + id, method: "PUT",
          upload_url: "http://127.0.0.1:" + mock.address().port + "/upload/" + id,
          upload_headers: [{ key: "Content-Type", value: JSON.parse(bytes).content_type }] } });
      }
      if (path.startsWith("/upload/")) {
        assert.equal(req.headers.authorization, undefined);
        assert.ok(["video/mp4", "audio/mpeg", "image/png"].includes(req.headers["content-type"]));
        receivedFiles.add("mediakit://qa/" + path.split("/").pop());
        return res.writeHead(200).end();
      }
      if (path.startsWith("/api/tools/")) {
        assert.equal(req.headers.authorization, "Bearer isolated-media-kit");
        const tool = path.split("/").pop();
        const input = JSON.parse(bytes);
        upstreamCalls.push({ tool, input });
        for (const value of [input.audio_url, input.video_url, input.face_mappings?.[0]?.target_face_url].filter(Boolean)) {
          assert.ok(receivedFiles.has(value));
        }
        if (tool === "face-swap-video" && failFirstFace) {
          failFirstFace = false;
          jobsByToken.set(input.client_token, "amk-test-face-one");
          upstreamJobs.set("amk-test-face-one", tool);
          return json({ success: false }, 503);
        }
        const id = jobsByToken.get(input.client_token) ?? "amk-test-" + randomUUID();
        jobsByToken.set(input.client_token, id);
        upstreamJobs.set(id, tool);
        return json({ success: true, task_id: id });
      }
      if (path.startsWith("/api/tasks/")) {
        const tool = upstreamJobs.get(path.split("/").pop());
        assert.ok(tool);
        return json({ success: true, status: "completed", result: tool === "asr-subtitles"
          ? { duration: 2, subtitles: [{ subtitle_text: "欢迎观看", start_time: 0.1, end_time: 1.4 }] }
          : { video_url: "http://127.0.0.1:" + mock.address().port + "/result.mp4", duration: 2 } });
      }
      if (path === "/result.mp4") {
        assert.equal(req.headers.authorization, undefined);
        return res.writeHead(200, { "content-type": "video/mp4" }).end(video);
      }
      if (path === "/voice") {
        assert.equal(req.headers["x-api-key"], "isolated-voice");
        assert.equal(req.headers["x-api-resource-id"], "seed-tts-2.0");
        const payload = JSON.parse(bytes).req_params;
        assert.equal(payload.speaker, "zh_female_vv_uranus_bigtts");
        assert.equal(JSON.parse(payload.additions).aigc_watermark, true);
        upstreamCalls.push({ tool: "voice" });
        if (failVoice) return res.writeHead(502).end();
        return res.writeHead(200, { "content-type": "text/event-stream" }).end(
          "event: 352\ndata: " + JSON.stringify({ code: 0, data: audio.toString("base64") })
            + '\n\nevent: 152\ndata: {"code":20000000,"usage":{"text_words":4}}\n\n',
        );
      }
      json({}, 404);
    } catch (error) {
      stubFailure = error;
      json({}, 500);
    }
  });
  const db = new PrismaService();
  let app, fixture, other;
  try {
    await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + mock.address().port;
    Object.assign(process.env, {
      MEDIAKIT_API_KEY: "isolated-media-kit", CONTENT_DOUBAO_VOICE_API_KEY: "isolated-voice",
      CONTENT_TEST_MEDIAKIT_URL: origin + "/api", CONTENT_TEST_VOICE_URL: origin + "/voice",
      CONTENT_STORAGE_PATH: join(tmp, "assets"), NATIVE_AI_MODEL_ENABLED: "true", AGENT_RUNTIME_PROVIDER: "test-model",
    });
    delete process.env.RUNTIME_MANAGER_SOCKET;
    app = await createApp();
    fixture = await createFixture(db, "erp-flow-test-media-tools-" + randomUUID().slice(0, 8));
    other = await createFixture(db, "erp-flow-test-media-other-" + randomUUID().slice(0, 8));
    for (const f of [fixture, other]) {
      await db.tenantApp.create({ data: { tenantId: f.tenant.id, appId: "content" } });
      await db.tenantCapability.create({ data: { tenantId: f.tenant.id, capability: "ai", delivered: true, enabled: true } });
    }
    await db.membership.create({ data: { tenantId: other.tenant.id, userId: fixture.accounts.admin.userId, role: "admin" } });
    const member = fixture.accounts.admin;
    const context = await app.get(AuthService).taskContext({
      tenantId: fixture.tenant.id, membershipId: member.memberId, userId: member.userId, appId: "content", taskId: randomUUID(),
    });
    await app.get(ContentService).grant(context, { membershipId: fixture.accounts.reviewer.memberId, role: "viewer" });
    const models = app.get(ModelGateway);
    models.status = async () => ({ configured: true });
    models.complete = async (_context, messages) => {
      translationCalls++;
      assert.deepEqual(JSON.parse(messages[1].content), ["欢迎观看"]);
      return '["Thanks for watching"]';
    };
    const h = await fixtureHttp(app, fixture);
    const api = "http://127.0.0.1:" + app.getHttpServer().address().port + "/api/v1";
    const base = "/tenants/" + fixture.tenant.slug + "/apps/content";
    const root = base + "/media-tools";
    const req = async (url, method, body, actor, status) => (await h.request(root + url, method, body, actor, status)).data;
    const upload = async (slot, bytes, expected = 201, actor = "admin") => {
      const r = await fetch(api + root + "/inputs/" + slot, {
        method: "POST", headers: { Origin: process.env.WEB_ORIGIN || "http://127.0.0.1:4601",
          Cookie: h.cookies[actor], "Content-Type": "application/octet-stream" }, body: bytes,
      });
      const data = await r.json();
      assert.equal(r.status, expected, JSON.stringify(data));
      return data.id;
    };
    const m = app.get(ContentMediaToolsService);
    const submit = (input, expected = 201, actor = "admin") => req("/jobs", "POST", {
      requestKey: randomUUID(), ...input,
    }, actor, expected);
    const history = async (kind, actor) => (await req("/jobs/" + kind, "GET", undefined, actor)).jobs;
    const finish = async (job, expected = "succeeded") => {
      for (let i = 0; i < 15; i++) {
        const old = await db.contentMediaJob.findUniqueOrThrow({ where: { id: job.id } });
        if (!["queued", "running"].includes(old.status)) break;
        await db.contentMediaJob.update({ where: { id: job.id }, data: { nextRunAt: new Date(0) } });
        await m.tick();
      }
      const updated = (await history(job.kind)).find((item) => item.id === job.id);
      assert.equal(updated.status, expected, JSON.stringify(updated));
      return updated;
    };
    const getArtifact = async (artifact, status = 200, actor = "admin", tenantBase = base) => {
      const r = await fetch(api + tenantBase + "/assets/" + artifact.id + "/file", { headers: { Cookie: h.cookies[actor] } });
      assert.equal(r.status, status);
      return Buffer.from(await r.arrayBuffer());
    };

    assert.equal((await req("/availability/voice-over")).blocker, null);
    assert.ok((await req("/availability/lip-sync", "GET", undefined, "reviewer")).blocker);
    await upload("video", video, 403, "reviewer");
    await upload("face", Buffer.from("bad file"), 400);
    const streamed = await fetch(api + root + "/inputs/audio", {
      method: "POST", headers: { Origin: process.env.WEB_ORIGIN || "http://127.0.0.1:4601",
        Cookie: h.cookies.admin, "Content-Type": "application/octet-stream" },
      body: new ReadableStream({ start(controller) { controller.enqueue(audio); controller.close(); } }), duplex: "half",
    });
    assert.equal(streamed.status, 201);
    const videoId = await upload("video", video);
    const audioId = await upload("audio", audio);
    const faceId = await upload("face", face);
    await submit({ kind: "face-swap", videoId, faceId, consent: false }, 400);
    await submit({ kind: "voice-over", text: "测试" }, 403, "reviewer");
    const requestKey = randomUUID();
    const facePayload = { requestKey, kind: "face-swap", videoId, faceId, consent: true };
    const [faceJob, duplicate] = await Promise.all([submit(facePayload), submit(facePayload)]);
    assert.equal(faceJob.id, duplicate.id);
    await submit({ ...facePayload, faceId: randomUUID() }, 409);
    const swap = await finish(faceJob);
    assert.equal(upstreamCalls.filter((call) => call.tool === "face-swap-video").length, 2);
    assert.equal(jobsByToken.size, 1);
    assert.equal((await history("face-swap", "reviewer")).length, 0);
    await getArtifact(swap.artifacts[0], 404, "reviewer");
    await getArtifact(swap.artifacts[0], 404, "admin", "/tenants/" + other.tenant.slug + "/apps/content");
    const swapBytes = await getArtifact(swap.artifacts[0]);
    assert.match(swapBytes.toString("latin1"), /AIGC/);
    const oldSwap = await db.contentMediaJob.findUniqueOrThrow({ where: { id: swap.id } });
    assert.ok(oldSwap.checkpoint.videoId);
    await assert.rejects(async () => readFileSync(join(process.env.CONTENT_STORAGE_PATH, fixture.tenant.id, oldSwap.checkpoint.videoId + ".bin")), { code: "ENOENT" });

    const asr = await finish(await submit({ kind: "auto-subtitles", sourceId: videoId, sourceType: "video" }));
    assert.equal((await getArtifact(asr.artifacts[0])).toString().trim(), readySrt.trim());
    const asrAudio = await finish(await submit({ kind: "auto-subtitles", sourceId: audioId, sourceType: "audio" }));
    assert.equal((await getArtifact(asrAudio.artifacts[0])).toString().trim(), readySrt.trim());
    const badSrt = readySrt.replace("01,400", "10,000");
    await submit({ kind: "burn-subtitles", videoId, srt: badSrt }, 400);
    const providerCountBeforeBurn = upstreamCalls.length;
    const burn = await finish(await submit({ kind: "burn-subtitles", videoId, srt: readySrt }));
    assert.ok((await getArtifact(burn.artifacts[0])).length > 1000);
    assert.equal(upstreamCalls.length, providerCountBeforeBurn);
    const markedBurn = await finish(await submit({ kind: "burn-subtitles", videoId: swap.artifacts[0].id, srt: readySrt }));
    assert.match((await getArtifact(markedBurn.artifacts[0])).toString("latin1"), /AIGC/);

    const voice = await finish(await submit({ kind: "voice-over", text: "欢迎观看" }));
    assert.ok((await getArtifact(voice.artifacts[0])).equals(audio));
    const lip = await finish(await submit({ kind: "lip-sync", videoId, audioId: voice.artifacts[0].id, consent: true }));
    assert.match((await getArtifact(lip.artifacts[0])).toString("latin1"), /AIGC/);
    const finished = await finish(await submit({ kind: "presenter-video", videoId, text: "欢迎观看", consent: true }));
    assert.deepEqual(finished.artifacts.map((a) => a.filename), ["AI 配音.mp3", "自动字幕.srt", "口播成片.mp4"]);
    const result = await getArtifact(finished.artifacts[2]);
    const finalPath = join(tmp, "presenter.mp4");
    require("node:fs").writeFileSync(finalPath, result);
    const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", finalPath]));
    assert.equal(info.streams.length, 2);
    assert.equal(JSON.parse(info.format.tags.AIGC).Label, "1");
    const translation = await finish(await submit({ kind: "translate-subtitles", srt: readySrt, language: "en" }));
    assert.match((await getArtifact(translation.artifacts[0])).toString(), /00:00:00,100 --> 00:00:01,400\nThanks for watching/);
    assert.equal(translationCalls, 1);

    await req("/availability/translate-video", "GET", undefined, "admin", 404);
    await submit({ kind: "translate-video", videoId, consent: true }, 400);

    failVoice = true;
    await finish(await submit({ kind: "voice-over", text: "测试不确定结果" }), "needs_reconciliation");
    await m.tick();
    assert.equal(upstreamCalls.filter((call) => call.tool === "voice").length, 3);
    delete process.env.CONTENT_DOUBAO_VOICE_API_KEY;
    assert.ok((await req("/availability/voice-over")).blocker);
    await submit({ kind: "voice-over", text: "未配置" }, 503);
    assert.equal((await req("/availability/burn-subtitles")).blocker, null);
    const usage = await db.usageRecord.findMany({ where: { tenantId: fixture.tenant.id, metric: { startsWith: "content.media." } } });
    assert.equal(usage.length, 9);
    assert.ok(usage.every((item) => item.cost === null));
    assert.ifError(stubFailure);
    console.log("Content media tools passed: 7 tools, 9 successful jobs, tenant and member isolation, consent, billing receipts, uncertain request and retry deduplication.");
  } finally {
    await app?.close();
    if (other) await cleanupFixture(db, other);
    if (fixture) {
      await db.usageRecord.deleteMany({ where: { tenantId: fixture.tenant.id } });
      await db.aiModelUsage.deleteMany({ where: { tenantId: fixture.tenant.id } });
      await cleanupFixture(db, fixture);
    }
    await db.$disconnect();
    mock.closeAllConnections();
    await new Promise((resolve) => mock.close(resolve));
  }
};
run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => rmSync(tmp, { recursive: true, force: true }));
