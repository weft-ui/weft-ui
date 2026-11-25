// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const SERVER = fileURLToPath(new URL("../../packages/content-mapper/src/server.ts", import.meta.url));

function frame(payload: object): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`, "ascii"),
    body,
  ]);
}

function parseResponses(buf: Buffer): unknown[] {
  const out: unknown[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const headerEnd = buf.indexOf("\r\n\r\n", offset);
    if (headerEnd === -1) break;
    const header = buf.subarray(offset, headerEnd).toString("ascii");
    const len = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
    const start = headerEnd + 4;
    out.push(JSON.parse(buf.subarray(start, start + len).toString("utf8")));
    offset = start + len;
  }
  return out;
}

test("server parses multi-header CRLF frames, ignores notifications, and finishes in-flight work before exit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "weft-mapper-srv-"));
  const file = join(dir, "Hello.weft");
  writeFileSync(file, "component Hello() { Text(\"hi\") }\n");
  try {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));

    // Send notification (no id), followed immediately by requests + stdin.end().
    child.stdin.write(frame({ jsonrpc: "2.0", method: "notifications/initialized" }));
    child.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { positionEncodings: ["utf-8"] } }));
    child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "openProject", params: { configFileName: join(dir, "tsconfig.json"), projectHandle: "p1" } }));
    child.stdin.write(frame({ jsonrpc: "2.0", id: 3, method: "transform", params: { fileName: file, content: 'component Hello() { Text("hi") }\n', projectHandle: "p1" } }));
    child.stdin.end();

    const code = await new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));
    expect(Buffer.concat(stderr).toString("utf8")).toBe("");
    expect(code).toBe(0);
    const messages = parseResponses(Buffer.concat(chunks)) as Array<{ id: number; result?: unknown; error?: unknown }>;
    expect(messages.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(messages.every((m) => m.error === undefined)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
