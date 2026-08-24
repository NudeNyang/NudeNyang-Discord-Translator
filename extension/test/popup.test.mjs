import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const popupJs = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupHtml = fs.readFileSync(new URL("../popup.html", import.meta.url), "utf8");

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
