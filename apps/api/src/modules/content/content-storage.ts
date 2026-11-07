import { mkdir, writeFile, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
export const storageRoot = () =>
  resolve(process.env.CONTENT_STORAGE_PATH ?? "var/content");
export function filePath(tenant: string, id: string, extension = "bin") {
  if (
    !/^[a-f0-9-]{36}$/.test(tenant) ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !["bin", "zip", "thumb"].includes(extension)
  )
    throw Error("CONTENT_STORAGE_ID");
  return join(storageRoot(), tenant, id + "." + extension);
}
export async function putFile(
  tenant: string,
  id: string,
  bytes: Buffer,
  extension = "bin",
) {
  const target = filePath(tenant, id, extension);
  await mkdir(join(storageRoot(), tenant), { recursive: true, mode: 0o700 });
  const temp = target + "." + randomUUID() + ".tmp";
  await writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, target);
}
export const getFile = (tenant: string, id: string, extension = "bin") =>
  readFile(filePath(tenant, id, extension));
export const removeFile = (tenant: string, id: string, extension = "bin") =>
  unlink(filePath(tenant, id, extension)).catch(() => {});
export function mediaOperation(input: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.KNOWLEDGE_PYTHON_PATH ?? "python3",
      [join(__dirname, "content-media.py")],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
      },
    );
    let result = Buffer.alloc(0),
      error = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("CONTENT_MEDIA_TIMEOUT"));
    }, 60000);
    child.stdout.on("data", (b) => {
      result = Buffer.concat([result, b]);
      if (result.length > (input.large ? 64 : 48) * 1024 * 1024) child.kill("SIGKILL");
    });
    child.stderr.on("data", (b) => {
      error += b.toString().slice(0, 500);
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code) return reject(Error("CONTENT_MEDIA_INVALID"));
      try {
        resolve(JSON.parse(result.toString()));
      } catch {
        reject(Error("CONTENT_MEDIA_INVALID"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
