import assert from "node:assert/strict";
import test from "node:test";
import "../content-helpers.js";

const {
  createScanBatch,
  groupTranslationApplications,
  isElementNearViewport,
  initialTranslationEnabled,
  isQuickToggleShortcut,
  isUrlLikeLinkText,
  pageTranslationEnabled,
  registerTranslationBlock,
  runtimeMessageFailure,
  scanRootForAddedNode,
  takeTranslationBatch,
  webSchedulingProfile,
} = globalThis.NudeNyangContentHelpers;

test("범용 사이트는 저장된 전역 설정과 무관하게 사용자가 켜기 전까지 대기한다", () => {
  assert.equal(initialTranslationEnabled(true, { id: "web", manualOnly: true }), false);
  assert.equal(initialTranslationEnabled(false, { id: "web", manualOnly: true }), false);
  assert.equal(initialTranslationEnabled(true, { id: "github" }), true);
  assert.equal(initialTranslationEnabled(false, { id: "github" }), false);
  assert.equal(initialTranslationEnabled(true, null), false);
});

test("탭에서 선택한 번역 상태는 페이지와 사이트가 바뀌어도 우선 유지한다", () => {
  assert.equal(pageTranslationEnabled({
    adapter: { id: "web", manualOnly: true },
    storedEnabled: true,
    tabEnabled: true,
    webEnabled: true,
    sitePolicy: "default",
  }), true);
  assert.equal(pageTranslationEnabled({
    adapter: { id: "github" },
    storedEnabled: true,
    tabEnabled: false,
    webEnabled: true,
    sitePolicy: "always",
  }), false);
  assert.equal(pageTranslationEnabled({
    adapter: { id: "web", manualOnly: true },
    storedEnabled: true,
    tabEnabled: null,
    webEnabled: true,
    sitePolicy: "always",
  }), true);
  assert.equal(pageTranslationEnabled({
    adapter: null,
    storedEnabled: true,
    tabEnabled: true,
    webEnabled: true,
    sitePolicy: "default",
  }), false);
});

test("보조키 없는 F4만 빠른 번역 전환으로 판정한다", () => {
  assert.equal(isQuickToggleShortcut({ key: "F4" }), true);
  assert.equal(isQuickToggleShortcut({ key: "Unidentified", code: "F4" }), true);
  assert.equal(isQuickToggleShortcut({ key: "F4", ctrlKey: true }), false);
  assert.equal(isQuickToggleShortcut({ key: "F4", altKey: true }), false);
  assert.equal(isQuickToggleShortcut({ key: "F4", shiftKey: true }), false);
  assert.equal(isQuickToggleShortcut({ key: "F4", metaKey: true }), false);
  assert.equal(isQuickToggleShortcut({ key: "F4", repeat: true }), false);
  assert.equal(isQuickToggleShortcut({ key: "F4", isComposing: true }), false);
  assert.equal(isQuickToggleShortcut({ key: "F5" }), false);
});

test("주소와 도메인으로 표시된 링크만 번역에서 보호한다", () => {
  assert.equal(isUrlLikeLinkText("https://example.com/path", "https://example.com/path"), true);
  assert.equal(isUrlLikeLinkText("photopea.com", "https://www.photopea.com/"), true);
  assert.equal(isUrlLikeLinkText("sci-hub.se", "https://sci-hub.se/"), true);
  assert.equal(isUrlLikeLinkText("GitHub", "https://github.com/"), false);
  assert.equal(isUrlLikeLinkText("developer platform", "https://example.com/platform"), false);
});

test("긴 문서의 블록 등록은 위치를 동기 계산하지 않고 관찰자에 한 번만 맡긴다", () => {
  const block = {};
  const observed = new WeakSet();
  const calls = [];
  const observer = { observe(value) { calls.push(value); } };

  assert.equal(registerTranslationBlock(block, observed, observer), true);
  assert.equal(registerTranslationBlock(block, observed, observer), false);
  assert.deepEqual(calls, [block]);
});

test("React가 교체한 텍스트 노드는 현재 문단을 다시 스캔한다", () => {
  const block = { kind: "block" };
  const parent = {
    closest(selector) {
      assert.equal(selector, ".markdown-body p");
      return block;
    },
  };
  const textNode = { nodeType: 3, parentElement: parent };

  assert.equal(scanRootForAddedNode(textNode, ".markdown-body p"), block);
});

test("추가된 요소 노드는 그 요소부터 스캔한다", () => {
  const element = { nodeType: 1 };
  assert.equal(scanRootForAddedNode(element, ".markdown-body p"), element);
});

test("스캔할 수 없는 노드는 무시한다", () => {
  assert.equal(scanRootForAddedNode({ nodeType: 8 }, ".markdown-body p"), null);
});

test("연속 DOM 변경의 재스캔 루트를 취소하지 않고 모두 보존한다", () => {
  const batch = createScanBatch();
  const first = { isConnected: true };
  const second = { isConnected: true };
  batch.add(first);
  batch.add(second);

  assert.deepEqual(batch.drain({ isDocument: true }), [first, second]);
  assert.deepEqual(batch.drain({ isDocument: true }), []);
});

test("끊어진 변경 루트는 가상 스크롤 문서 전체를 다시 훑지 않고 버린다", () => {
  const batch = createScanBatch();
  const documentRoot = { isDocument: true };
  batch.add({ isConnected: false });
  batch.add({ isConnected: false });

  assert.deepEqual(batch.drain(documentRoot), []);
});

test("웹 처리 모드는 Discord와 무관한 유휴 배치 프로필로 변환된다", () => {
  assert.deepEqual(webSchedulingProfile("balanced", false), {
    collectDelayMs: 280,
    applyDelayMs: 180,
    viewportMargin: 220,
    maxItems: 24,
    maxChars: 16000,
  });
  assert.deepEqual(webSchedulingProfile("balanced", true), {
    collectDelayMs: 420,
    applyDelayMs: 240,
    viewportMargin: 180,
    maxItems: 32,
    maxChars: 32000,
  });
  assert.equal(webSchedulingProfile("responsive", false).collectDelayMs, 140);
  assert.equal(webSchedulingProfile("economy", true).collectDelayMs, 700);
  assert.equal(webSchedulingProfile("invalid", true).collectDelayMs, 420);
});

test("중첩된 DOM 변경은 가장 바깥쪽 루트만 다시 스캔한다", () => {
  const batch = createScanBatch();
  const parent = {
    isConnected: true,
    contains(node) {
      return node === child;
    },
  };
  const child = {
    isConnected: true,
    contains() {
      return false;
    },
  };

  batch.add(child);
  batch.add(parent);

  assert.deepEqual(batch.drain({ isDocument: true }), [parent]);
});

test("화면과 가까운 문단만 즉시 번역 대상으로 판정한다", () => {
  const element = {
    isConnected: true,
    getBoundingClientRect() {
      return { width: 320, height: 80, top: 120, bottom: 200 };
    },
  };

  assert.equal(isElementNearViewport(element, 900, 500), true);

  element.getBoundingClientRect = () => ({ width: 320, height: 80, top: 1500, bottom: 1580 });
  assert.equal(isElementNearViewport(element, 900, 500), false);
});

test("숨겨졌거나 화면 위에서 멀어진 문단은 즉시 번역하지 않는다", () => {
  const hidden = {
    isConnected: true,
    getBoundingClientRect() {
      return { width: 0, height: 0, top: 0, bottom: 0 };
    },
  };
  const farAbove = {
    isConnected: true,
    getBoundingClientRect() {
      return { width: 320, height: 80, top: -700, bottom: -620 };
    },
  };

  assert.equal(isElementNearViewport(hidden, 900, 500), false);
  assert.equal(isElementNearViewport(farAbove, 900, 500), false);
});

test("번역 직전에 끊어진 DOM 작업을 버리고 현재 작업만 묶는다", () => {
  const current = { id: "current", text: "hello" };
  const stale = { id: "stale", text: "old text" };
  const queue = [stale, current];
  const discarded = [];

  const batch = takeTranslationBatch(queue, {
    maxItems: 32,
    maxChars: 32000,
    isCurrent: (item) => item === current,
    isNearViewport: () => true,
    onDiscard: (item) => discarded.push(item.id),
  });

  assert.deepEqual(batch, [current]);
  assert.deepEqual(discarded, ["stale"]);
  assert.deepEqual(queue, []);
});

test("사용자가 스크롤해 멀어진 대기 작업은 모델로 보내지 않는다", () => {
  const near = { id: "near", text: "visible" };
  const far = { id: "far", text: "offscreen" };
  const queue = [far, near];
  const discarded = [];

  const batch = takeTranslationBatch(queue, {
    maxItems: 32,
    maxChars: 32000,
    isCurrent: () => true,
    isNearViewport: (item) => item === near,
    onDiscard: (item) => discarded.push(item.id),
  });

  assert.deepEqual(batch, [near]);
  assert.deepEqual(discarded, ["far"]);
});

test("문자 제한을 넘는 다음 작업은 대기열에 보존한다", () => {
  const first = { id: "first", text: "12345" };
  const next = { id: "next", text: "67890" };
  const queue = [first, next];

  const batch = takeTranslationBatch(queue, {
    maxItems: 32,
    maxChars: 8,
    isCurrent: () => true,
    isNearViewport: () => true,
    onDiscard: () => assert.fail("현재 작업을 버리면 안 된다"),
  });

  assert.deepEqual(batch, [first]);
  assert.deepEqual(queue, [next]);
});

test("인라인 링크가 많은 한 문단은 항목 제한 때문에 요청 중간에서 잘리지 않는다", () => {
  const paragraph = Array.from({ length: 27 }, (_, index) => ({
    id: `paragraph-${index}`,
    blockId: "paragraph",
    text: `fragment-${index}`,
  }));
  const nextParagraph = [
    { id: "next-1", blockId: "next", text: "next fragment 1" },
    { id: "next-2", blockId: "next", text: "next fragment 2" },
  ];
  const queue = [...paragraph, ...nextParagraph];

  const batch = takeTranslationBatch(queue, {
    maxItems: 24,
    maxChars: 16000,
    isCurrent: () => true,
    isNearViewport: () => true,
    onDiscard: () => assert.fail("현재 문단을 버리면 안 된다"),
  });

  assert.deepEqual(batch, paragraph);
  assert.deepEqual(queue, nextParagraph);
});

test("다음 문단 전체가 한도를 넘으면 현재 요청에 일부만 끼워 넣지 않는다", () => {
  const first = [
    { id: "first-1", blockId: "first", text: "1234" },
    { id: "first-2", blockId: "first", text: "5678" },
  ];
  const next = [
    { id: "next-1", blockId: "next", text: "abcd" },
    { id: "next-2", blockId: "next", text: "efgh" },
  ];
  const queue = [...first, ...next];

  const batch = takeTranslationBatch(queue, {
    maxItems: 20,
    maxChars: 12,
    isCurrent: () => true,
    isNearViewport: () => true,
    onDiscard: () => assert.fail("현재 문단을 버리면 안 된다"),
  });

  assert.deepEqual(batch, first);
  assert.deepEqual(queue, next);
});

test("번역 응답은 원래 요청 순서를 유지한 문단 묶음으로 구성한다", () => {
  const batch = [
    { id: "a-1", blockId: "a" },
    { id: "a-2", blockId: "a" },
    { id: "b-1", blockId: "b" },
    { id: "b-2", blockId: "b" },
  ];
  const results = new Map([
    ["a-1", "번역 A1"],
    ["a-2", "번역 A2"],
    ["b-1", "번역 B1"],
  ]);

  assert.deepEqual(groupTranslationApplications(batch, results), {
    blocks: [
      {
        blockId: "a",
        applications: [
          { item: batch[0], translated: "번역 A1" },
          { item: batch[1], translated: "번역 A2" },
        ],
      },
      {
        blockId: "b",
        applications: [
          { item: batch[2], translated: "번역 B1" },
        ],
      },
    ],
    missing: [batch[3]],
  });
});

test("확장 재로딩으로 무효화된 콘텐츠 스크립트는 재시도하지 않는다", () => {
  assert.deepEqual(
    runtimeMessageFailure("request-1", new Error("Extension context invalidated.")),
    {
      type: "error",
      requestId: "request-1",
      code: "extension_context_invalidated",
      message: "확장 프로그램이 업데이트되었습니다. 페이지를 새로 고치십시오.",
      detail: "Extension context invalidated.",
      retryable: false,
    },
  );
});

test("일반 확장 메시지 오류는 다시 시도할 수 있는 연결 오류로 유지한다", () => {
  const failure = runtimeMessageFailure("request-2", "The message port closed");

  assert.equal(failure.code, "extension_message_failed");
  assert.equal(failure.retryable, true);
});
