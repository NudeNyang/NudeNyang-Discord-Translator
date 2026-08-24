import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const popupJs = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupHtml = fs.readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const popupCss = fs.readFileSync(new URL("../popup.css", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("팝업의 사용자 문구는 공식체를 사용한다", () => {
  const productCopy = `${popupHtml}\n${popupJs}`;
  assert.doesNotMatch(productCopy, /아니야|해줘|복원했어|있어\./);
  assert.match(productCopy, /지원되지 않습니다/);
  assert.match(productCopy, /실행해 주십시오/);
});

test("팝업은 마지막으로 사용한 브라우저 창의 활성 탭을 조회한다", () => {
  assert.match(popupJs, /lastFocusedWindow:\s*true/);
});

test("탭 응답 실패를 미지원 페이지와 구분해 안내한다", () => {
  assert.match(popupJs, /페이지와 연결할 수 없습니다/);
});

test("팝업은 메인 앱의 파란색 다크 테마 토큰을 사용한다", () => {
  assert.match(popupCss, /--bg:\s*#08141d/);
  assert.match(popupCss, /--surface:\s*#0f202c/);
  assert.match(popupCss, /--accent:\s*#5aa8f5/);
  assert.match(popupCss, /--accent-strong:\s*#76b8fa/);
  assert.doesNotMatch(popupCss, /#beff6b|#87df61/);
});

test("확장과 툴바는 제품의 육구 아이콘을 사용한다", () => {
  assert.deepEqual(manifest.icons, {
    16: "icons/paw-16.png",
    32: "icons/paw-32.png",
    48: "icons/paw-48.png",
    128: "icons/paw-128.png",
  });
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
});
