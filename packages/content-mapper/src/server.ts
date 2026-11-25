// TypeScript content mapper process for `.weft` files: JSON-RPC requests from
// TypeScript on stdin, responses on stdout, both framed with `Content-Length`
// headers. The transform itself is `mapContent` from `@weft-ui/compiler`.
import { readFileSync } from "node:fs";
import { mapContent } from "@weft-ui/compiler";
import type {
  CloseProjectParams,
  InitializeParams,
  InitializeResult,
  OpenProjectParams,
  PositionEncoding,
  TransformParams,
  TransformResult,
} from "./protocol.ts";

/** Code of mapper diagnostics; Weft diagnostics have no codes of their own. */
const DIAGNOSTIC_CODE = 1;

interface Request {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

class RequestError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const INVALID_PARAMS = -32602;

let encoding: PositionEncoding | undefined;
const projects = new Set<string>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function params<T>(request: Request, keys: readonly string[]): T {
  const value = request.params;
  if (!isObject(value) || keys.some((key) => typeof value[key] !== "string")) {
    throw new RequestError(INVALID_PARAMS, `${request.method} requires string parameters ${keys.join(", ")}`);
  }
  return value as T;
}

function initialize(request: Request): InitializeResult {
  const offered = isObject(request.params) ? (request.params as Partial<InitializeParams>).positionEncodings : undefined;
  // Rust works in bytes; UTF-16 positions are converted.
  encoding = (["utf-8", "utf-16"] as const).find((candidate) => offered?.includes(candidate));
  if (!encoding) throw new RequestError(INVALID_PARAMS, "TypeScript offers neither utf-8 nor utf-16 positions");
  return { positionEncoding: encoding, diagnosticSource: "weft" };
}

async function transform(request: Request): Promise<TransformResult> {
  const { fileName, content, projectHandle } = params<TransformParams>(request, ["fileName", "content", "projectHandle"]);
  if (!encoding) throw new Error("transform before initialize");
  if (!projects.has(projectHandle)) throw new Error(`project ${projectHandle} is not open`);
  const mapped = await mapContent(fileName.replaceAll("\\", "/"), content, encoding, (path) => readFileSync(path, "utf8"));
  return {
    text: mapped.text,
    extension: ".ts",
    mappings: mapped.mappings,
    diagnostics: mapped.diagnostics.map(({ message, start, length }) => ({
      messageText: message,
      start,
      length,
      code: DIAGNOSTIC_CODE,
    })),
  };
}

async function dispatch(request: Request): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return initialize(request);
    case "openProject":
      projects.add(params<OpenProjectParams>(request, ["configFileName", "projectHandle"]).projectHandle);
      return {};
    case "transform":
      return transform(request);
    case "closeProject":
      projects.delete(params<CloseProjectParams>(request, ["projectHandle"]).projectHandle);
      return null;
    default:
      throw new RequestError(-32601, `unknown method ${request.method}`);
  }
}

function send(message: object) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

async function handle(payload: string) {
  let request: Request;
  try {
    request = JSON.parse(payload) as Request;
  } catch {
    send({ id: null, error: { code: -32700, message: "invalid JSON" } });
    return;
  }
  if (!isObject(request) || typeof request.method !== "string") {
    const id = isObject(request) && (typeof request.id === "string" || typeof request.id === "number" || request.id === null)
      ? request.id
      : null;
    send({ id, error: { code: -32600, message: "not a request" } });
    return;
  }
  if (request.id === undefined) return;
  try {
    send({ id: request.id, result: await dispatch(request) });
  } catch (error) {
    const code = error instanceof RequestError ? error.code : -32603;
    send({ id: request.id, error: { code, message: error instanceof Error ? error.message : String(error) } });
  }
}

let buffer = Buffer.alloc(0);
let inFlight = 0;
let ending = false;
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const length = /^Content-Length: *(\d+) *\r?$/im.exec(buffer.subarray(0, headerEnd).toString("ascii"))?.[1];
    if (length === undefined) {
      console.error("weft content mapper: message without Content-Length");
      process.exit(1);
    }
    const start = headerEnd + 4;
    const end = start + Number(length);
    if (buffer.length < end) return;
    const payload = buffer.subarray(start, end).toString("utf8");
    buffer = buffer.subarray(end);
    inFlight++;
    void handle(payload).finally(() => {
      inFlight--;
      if (ending && inFlight === 0) process.exit(0);
    });
  }
});
// TypeScript closes stdin to shut the mapper down.
process.stdin.on("end", () => {
  ending = true;
  if (inFlight === 0) process.exit(0);
});
