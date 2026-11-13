import { BadRequestException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

export const mediaLimit = 32 * 1024 * 1024;
export const outputLimit = 64 * 1024 * 1024;
export const maxDuration = 180;
export const cueList = z.array(z.object({
  subtitle_text: z.string().trim().min(1).max(500),
  start_time: z.number().min(0).max(600),
  end_time: z.number().positive().max(600),
}).refine((cue) => cue.end_time > cue.start_time)).max(400);
export type Cue = z.infer<typeof cueList>[number];

const ffmpeg = () => process.env.CONTENT_FFMPEG_PATH || "ffmpeg";
const ffprobe = () => process.env.CONTENT_FFPROBE_PATH || "ffprobe";
const execute = promisify(execFile);
const run = (command: string, args: string[], timeout: number) =>
  execute(command, args, { timeout, maxBuffer: 256 * 1024, killSignal: "SIGKILL" });
async function tempFiles<T>(fn: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), "content-media-"));
  try { return await fn(folder); }
  finally { await rm(folder, { recursive: true, force: true }); }
}

export async function localMediaReady() {
  try {
    await Promise.all([run(ffprobe(), ["-version"], 3000), run(ffmpeg(), ["-version"], 3000)]);
    return true;
  } catch { return false; }
}

export async function inspectMedia(bytes: Buffer, slot: "video" | "audio" | "face", needsAudio: boolean) {
  return tempFiles(async (folder) => {
    const file = join(folder, "input");
    await writeFile(file, bytes, { mode: 0o600 });
    const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
    const mp4 = bytes.toString("ascii", 4, 8) === "ftyp";
    const wav = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
    const mp3 = bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224);
    const mime = slot === "video" && mp4 ? "video/mp4"
      : slot === "face" && png ? "image/png" : slot === "face" && jpeg ? "image/jpeg"
      : slot === "audio" && wav ? "audio/wav" : slot === "audio" && mp3 ? "audio/mpeg" : null;
    if (!mime) throw new BadRequestException("文件格式不受支持，请检查视频、图片或音频文件");
    try {
      const { stdout } = await run(ffprobe(), [
        "-v", "error", "-protocol_whitelist", "file", "-show_entries",
        "format=duration,format_name:format_tags=AIGC:stream=codec_type,width,height", "-of", "json", file,
      ], 8000);
      const info = JSON.parse(stdout) as {
        format?: { duration?: string; format_name?: string; tags?: Record<string, string> };
        streams?: { codec_type: string; width?: number; height?: number }[];
      };
      const video = info.streams?.find((stream) => stream.codec_type === "video");
      const audio = info.streams?.some((stream) => stream.codec_type === "audio");
      const format = info.format?.format_name?.split(",") ?? [];
      const duration = Number(info.format?.duration);
      if (slot === "audio" && !format.includes(wav ? "wav" : "mp3")) throw Error();
      if (slot === "video" && !format.includes("mp4")) throw Error();
      if (slot === "face" && !format.some((name) => name === "png_pipe" || name === "jpeg_pipe")) throw Error();
      if ((slot !== "audio" && (!video?.width || !video.height || video.width * video.height > 4096 * 2160))
        || ((needsAudio || slot === "audio") && !audio)
        || (slot !== "face" && (!Number.isFinite(duration) || duration <= 0 || duration > maxDuration))) throw Error();
      return { mime, duration: slot === "face" ? 0 : duration, aigc: Boolean(info.format?.tags?.AIGC) };
    } catch {
      throw new BadRequestException("无法读取素材。请检查音轨、文件格式、分辨率及 3 分钟时长限制");
    }
  });
}

export function parseSrt(source: string) {
  const raw = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const time = "(\\d{2}):(\\d{2}):(\\d{2})[,.](\\d{3})";
  const stamp = new RegExp("^" + time + " +--> +" + time + "$");
  const seconds = (parts: string[]) => {
    const [h, m, s, ms] = parts.map(Number);
    return m < 60 && s < 60 ? h * 3600 + m * 60 + s + ms / 1000 : NaN;
  };
  const rows = raw.split(/\n[ \t]*\n/).map((block) => {
    const [index, timing, ...text] = block.split("\n");
    const match = stamp.exec(timing?.trim() ?? "");
    if (!/^\d+$/.test(index.trim()) || !match) throw new BadRequestException("SRT 字幕的序号或时间格式无效");
    return { subtitle_text: text.join("\n"), start_time: seconds(match.slice(1, 5)), end_time: seconds(match.slice(5)) };
  });
  const parsed = cueList.safeParse(rows);
  if (!parsed.success) throw new BadRequestException("SRT 字幕时间或内容无效，每份最多 400 条");
  return parsed.data;
}

const stamp = (seconds: number) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
export const makeSrt = (cues: Cue[]) => cues.map((cue, index) =>
  [index + 1, stamp(cue.start_time).replace(".", ",") + " --> " + stamp(cue.end_time).replace(".", ","),
    cue.subtitle_text.replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n")].join("\n")).join("\n\n") + "\n";

export async function renderVideo(bytes: Buffer, cues: Cue[], marker: { id: string; duration: number } | undefined) {
  return tempFiles(async (folder) => {
    const input = join(folder, "input.mp4");
    const output = join(folder, "result.mp4");
    const subs = join(folder, "subtitles.srt");
    const label = join(folder, "label.ass");
    await writeFile(input, bytes, { mode: 0o600 });
    const fonts = join(folder, "fonts");
    await cp(join(__dirname, "fonts"), fonts, { recursive: true });
    const filters: string[] = [];
    if (cues.length) {
      // Escape ASS controls and formatting tags in user/provider text before libass renders it.
      const safe = cues.map((cue) => ({
        ...cue, subtitle_text: cue.subtitle_text.replace(/[{}<>\\]/g, (char) => ({
          "{": "｛", "}": "｝", "<": "＜", ">": "＞", "\\": "＼",
        })[char]!),
      }));
      await writeFile(subs, makeSrt(safe), { mode: 0o600 });
      filters.push("subtitles=" + subs + ":fontsdir=" + fonts + ":force_style='FontName=Noto Sans CJK SC,FontSize=17,Outline=1.5,MarginV=20'");
    }
    if (marker) {
      const end = stamp(marker.duration).slice(1, -1);
      const ass = [
        "[Script Info]", "ScriptType: v4.00+", "PlayResX: 384", "PlayResY: 288", "ScaledBorderAndShadow: yes",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Marker,Noto Sans CJK SC,14,&H00FFFFFF,&H00FFFFFF,&H00202020,&H00202020,0,0,0,0,100,100,0,0,1,1.5,0,9,12,12,12,1",
        "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:00.00," + end + ",Marker,,0,0,0,,AI 合成",
      ].join("\n") + "\n";
      await writeFile(label, ass, { mode: 0o600 });
      filters.push("ass=" + label + ":fontsdir=" + fonts);
    }
    await run(ffmpeg(), [
      "-nostdin", "-v", "error", "-protocol_whitelist", "file", "-threads", "2", "-i", input,
      "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-filter_threads", "1", "-vf", filters.join(","),
      "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-c:a", "aac",
      ...(marker ? ["-metadata", "AIGC=" + JSON.stringify({ Label: "1", ContentProducer: "知行方舟",
        ProduceID: marker.id, ReservedCode1: "", ContentPropagator: "知行方舟", PropagateID: marker.id, ReservedCode2: "" })] : []),
      "-movflags", "+faststart+use_metadata_tags", output,
    ], 170000);
    const result = await readFile(output);
    if (result.length > outputLimit) throw Error("OUTPUT_LIMIT");
    return result;
  });
}
