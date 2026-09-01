import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../../src-tauri/src/image_translation.rs", import.meta.url), "utf8");
const scriptMatch = source.match(/pub const IMAGE_UI_SCRIPT: &str = r##"\r?\n([\s\S]*?)\r?\n"##;/);
assert.ok(scriptMatch, "Rust 소스에서 이미지 번역 UI 스크립트를 찾을 수 있어야 해");
const imageScript = scriptMatch[1]
  .replace("__UI_LANGUAGE__", JSON.stringify("ko"))
  .replace("__GENERATED_IMAGE_COPIES__", "{}");

async function hoverImage(html, imageId) {
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://discord.com/channels/1/2",
  });
  const { window } = dom;
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: 1200 },
    innerHeight: { configurable: true, value: 900 },
  });
  window.Element.prototype.getBoundingClientRect = () => ({
    width: 600, height: 500, top: 20, right: 620, bottom: 520, left: 20,
    x: 20, y: 20, toJSON() {},
  });
  window.eval(imageScript);
  const image = window.document.getElementById(imageId);
  image.dispatchEvent(new window.MouseEvent("pointermove", {
    bubbles: true,
    clientX: 100,
    clientY: 100,
  }));
  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  return image.dataset.ntImageId || "";
}

test("프로필 배너와 장식 이미지는 미디어 번역 후보가 아니다", async () => {
  const imageId = await hoverImage(`
    <section role="dialog" aria-label="User Profile">
      <div class="modal_test">
        <img id="profile-banner" src="https://cdn.discordapp.com/banners/123/profile.png">
      </div>
    </section>
  `, "profile-banner");

  assert.equal(imageId, "");
});

test("사용자가 연 첨부 이미지 미디어는 계속 번역 후보가 된다", async () => {
  const imageId = await hoverImage(`
    <section role="dialog" aria-label="Media">
      <img id="attachment" src="https://cdn.discordapp.com/attachments/1/2/poster.png">
    </section>
  `, "attachment");

  assert.match(imageId, /^nt-image-/);
});
