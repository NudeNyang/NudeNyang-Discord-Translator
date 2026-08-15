import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import test from "node:test";

import worker from "../src/index.ts";
import { compareVersions } from "../src/semver.ts";

if (typeof crypto.subtle.timingSafeEqual !== "function") {
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    value(left, right) {
      return timingSafeEqual(Buffer.from(left), Buffer.from(right));
    },
  });
}

const encoder = new TextEncoder();
const handleRequest = (request, env) => worker.fetch(request, env);
const manifest = {
  version: "0.3.0-beta.1",
  notes: "테스트 업데이트",
  pub_date: "2026-08-10T00:00:00Z",
  installer_object_key: "beta/releases/0.3.0-beta.1/NudeNyangDiscordTranslator-Setup.exe",
  platforms: {
    "windows-x86_64": {
      object_key: "beta/releases/0.3.0-beta.1/NudeNyangDiscordTranslator-Setup.exe",
      signature: "signed-update",
    },
  },
};

function objectFrom(value, contentType = "application/json") {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return {
    body: bytes,
    size: bytes.byteLength,
    etag: "test-etag",
    httpEtag: '"test-etag"',
    httpMetadata: { contentType },
    async json() {
      return JSON.parse(new TextDecoder().decode(bytes));
    },
    writeHttpMetadata(headers) {
      headers.set("Content-Type", contentType);
    },
  };
}

function environment() {
  const objects = new Map([
    ["beta/latest.json", objectFrom(JSON.stringify(manifest))],
    [manifest.installer_object_key, objectFrom(encoder.encode("installer"), "application/octet-stream")],
  ]);
  return {
    BETA_TOKENS: "friend-a,friend-b",
    RELEASES: { async get(key) { return objects.get(key) || null; } },
  };
}

test("semantic beta versions are ordered correctly", () => {
  assert.equal(compareVersions("0.3.0-beta.1", "0.3.0-beta"), 1);
  assert.equal(compareVersions("0.3.0", "0.3.0-beta.9"), 1);
  assert.equal(compareVersions("0.3.0-beta.2", "0.3.0-beta.10"), -1);
});

test("update checks require a beta token", async () => {
  const response = await handleRequest(
    new Request("https://updates.example/v1/update/windows/x86_64/0.3.0-beta"),
    environment(),
  );
  assert.equal(response.status, 401);
});

test("authorized clients receive a newer signed update", async () => {
  const response = await handleRequest(
    new Request("https://updates.example/v1/update/windows/x86_64/0.3.0-beta", {
      headers: { Authorization: "Bearer friend-a" },
    }),
    environment(),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, "0.3.0-beta.1");
  assert.equal(body.signature, "signed-update");
  assert.equal(
    body.url,
    "https://updates.example/v1/artifacts/beta/releases/0.3.0-beta.1/NudeNyangDiscordTranslator-Setup.exe",
  );
});

test("current clients receive no-content", async () => {
  const response = await handleRequest(
    new Request("https://updates.example/v1/update/windows/x86_64/0.3.0-beta.1", {
      headers: { Authorization: "Bearer friend-a" },
    }),
    environment(),
  );
  assert.equal(response.status, 204);
});

test("installer links accept a revocable beta code", async () => {
  const response = await handleRequest(
    new Request("https://updates.example/v1/install?code=friend-b"),
    environment(),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition"), /NudeNyangDiscordTranslator-Setup\.exe/);
  assert.equal(await response.text(), "installer");
});
