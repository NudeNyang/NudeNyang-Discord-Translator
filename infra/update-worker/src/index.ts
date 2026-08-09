import { compareVersions } from "./semver";

const LATEST_MANIFEST_KEY = "beta/latest.json";
const RELEASE_PREFIX = "beta/releases/";

type PlatformRelease = {
  object_key: string;
  signature: string;
};

type UpdateManifest = {
  version: string;
  notes?: string;
  pub_date: string;
  installer_object_key: string;
  platforms: Record<string, PlatformRelease>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        event: "request_failed",
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : "unknown_error",
      }));
      return response("업데이트 서버에서 오류가 발생했습니다.", 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return response("허용되지 않은 요청입니다.", 405, { Allow: "GET, HEAD" });
  }
  if (url.pathname === "/health") {
    return Response.json({ status: "ok" }, { headers: privateHeaders() });
  }
  const updateMatch = url.pathname.match(
    /^\/v1\/update\/([a-z0-9_-]+)\/([a-z0-9_-]+)\/([^/]+)$/i,
  );
  if (updateMatch) {
    if (!(await authorized(request, env))) return unauthorized();
    const [, target, arch, encodedCurrentVersion] = updateMatch;
    return updateResponse(url, env, target, arch, decodeURIComponent(encodedCurrentVersion));
  }
  if (url.pathname.startsWith("/v1/artifacts/")) {
    if (!(await authorized(request, env))) return unauthorized();
    const key = decodeArtifactKey(url.pathname.slice("/v1/artifacts/".length));
    if (!key) return response("잘못된 업데이트 파일 경로입니다.", 400);
    return serveObject(request, env, key, false);
  }
  if (url.pathname === "/v1/install") {
    if (!(await tokenMatches(url.searchParams.get("code") ?? "", env))) return unauthorized();
    const manifest = await readManifest(env);
    if (manifest instanceof Response) return manifest;
    return serveObject(request, env, manifest.installer_object_key, true);
  }
  return response("찾을 수 없습니다.", 404);
}

async function updateResponse(
  url: URL,
  env: Env,
  target: string,
  arch: string,
  currentVersion: string,
): Promise<Response> {
  const manifest = await readManifest(env);
  if (manifest instanceof Response) return manifest;
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    return new Response(null, { status: 204, headers: privateHeaders() });
  }
  const platform = manifest.platforms[`${target}-${arch}`];
  if (!platform) return new Response(null, { status: 204, headers: privateHeaders() });
  return Response.json(
    {
      version: manifest.version,
      notes: manifest.notes ?? "",
      pub_date: manifest.pub_date,
      url: `${url.origin}/v1/artifacts/${encodeArtifactKey(platform.object_key)}`,
      signature: platform.signature,
    },
    { headers: privateHeaders() },
  );
}

async function readManifest(env: Env): Promise<UpdateManifest | Response> {
  const object = await env.RELEASES.get(LATEST_MANIFEST_KEY);
  if (!object) return response("배포된 베타 릴리스가 없습니다.", 404);
  let manifest: unknown;
  try {
    manifest = await object.json<unknown>();
  } catch {
    return response("업데이트 정보가 손상되었습니다.", 500);
  }
  return isUpdateManifest(manifest)
    ? manifest
    : response("업데이트 정보 형식이 올바르지 않습니다.", 500);
}

function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (!isRecord(value) || !isRecord(value.platforms)) return false;
  return (
    typeof value.version === "string" &&
    typeof value.pub_date === "string" &&
    typeof value.installer_object_key === "string" &&
    value.installer_object_key.startsWith(RELEASE_PREFIX) &&
    Object.values(value.platforms).every(isPlatformRelease)
  );
}

function isPlatformRelease(value: unknown): value is PlatformRelease {
  return (
    isRecord(value) &&
    typeof value.object_key === "string" &&
    value.object_key.startsWith(RELEASE_PREFIX) &&
    typeof value.signature === "string" &&
    value.signature.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function serveObject(
  request: Request,
  env: Env,
  key: string,
  attachment: boolean,
): Promise<Response> {
  if (!key.startsWith(RELEASE_PREFIX) || key.includes("..")) {
    return response("잘못된 업데이트 파일 경로입니다.", 400);
  }
  const object = await env.RELEASES.get(key);
  if (!object) return response("업데이트 파일을 찾을 수 없습니다.", 404);
  const headers = privateHeaders();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  if (attachment) {
    const filename = (key.split("/").at(-1) ?? "NudeNyangTranslator-Setup.exe").replaceAll('"', "");
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  }
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get("Authorization") ?? "";
  return tokenMatches(authorization.replace(/^Bearer\s+/i, ""), env);
}

async function tokenMatches(candidate: string, env: Env): Promise<boolean> {
  if (!candidate) return false;
  const tokens = env.BETA_TOKENS.split(",")
    .map(token => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    if (await constantTimeEqual(candidate, token)) return true;
  }
  return false;
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

function encodeArtifactKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function decodeArtifactKey(path: string): string | null {
  try {
    return path.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

function privateHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

function unauthorized(): Response {
  return response("베타 업데이트 접근 권한이 없습니다.", 401, {
    "WWW-Authenticate": 'Bearer realm="NudeNyang Translator Beta"',
  });
}

function response(
  body: BodyInit | null,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = privateHeaders();
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, { status, headers });
}
