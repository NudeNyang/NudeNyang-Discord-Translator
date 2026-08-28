import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { VIRTUAL_LIST_HTML } from "./fixtures/dom-translation.mjs";
import "../content-helpers.js";

const {
  addTranslationItems,
  closestTranslationBlock,
  createScanBatch,
  createTranslationReplayCache,
  sameMessageContext,
  groupTranslationApplications,
  isElementNearViewport,
  initialTranslationEnabled,
  isExplicitExclusionBypassBlock,
  isQuickToggleShortcut,
  isUrlLikeLinkText,
  pageTranslationEnabled,
  registerTranslationBlock,
  runtimeMessageFailure,
  scanRootForAddedNode,
  syncTrackedTranslationDisplay,
  takeTranslationBatch,
  translationBatchLimits,
  webSchedulingProfile,
} = globalThis.NudeNyangContentHelpers;

test("재표시 캐시는 항목·문자 수 상한과 LRU·삭제·전체 폐기를 지킨다", () => {
  const cache = createTranslationReplayCache({ maxEntries: 2, maxChars: 20 });
  cache.set("one", ["ONE"]);
  cache.set("two", ["TWO"]);
  assert.deepEqual(cache.get("one"), ["ONE"]);
  cache.set("three", ["THREE"]);
  assert.equal(cache.get("two"), null);
  assert.equal(cache.size, 2);
  assert.ok(cache.chars <= 20);
  cache.set("large", ["x".repeat(30)]);
  assert.equal(cache.get("large"), null);
  cache.delete("one");
  assert.equal(cache.size, 1);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.chars, 0);
});

test("범용 목록의 첫 행 교체와 실제 대화·루트·주소 전환을 구분한다", () => {
  const dom = new JSDOM(VIRTUAL_LIST_HTML);
  try {
    const root = dom.window.document.querySelector("main");
    const first = root.firstElementChild;
    const witness = root.lastElementChild;
    const context = { id: "fixture", root, routeKey: "conversation-a", identityNodes: [root, first] };
    const nextFirst = first.cloneNode(true);
    first.replaceWith(nextFirst);
    const next = { ...context, identityNodes: [root, nextFirst] };
    assert.equal(sameMessageContext(context, next, new Set([first, witness])), true);
    assert.equal(sameMessageContext(context, { ...next, routeKey: "conversation-b" }, new Set([witness])), false);
    assert.equal(sameMessageContext(context, { ...next, root: root.cloneNode(true) }, new Set([witness])), false);
    witness.remove();
    assert.equal(sameMessageContext(context, next, new Set([first, witness])), false);
  } finally { dom.window.close(); }
});

test("웹 번역 토글은 저장된 번역을 버리지 않고 원문과 즉시 교체한다", () => {
  const translatedNode = { isConnected: true, nodeValue: "번역문" };
  const pendingNode = { isConnected: true, nodeValue: "Pending source" };
  const tracked = new Set([translatedNode, pendingNode]);
  const states = new WeakMap([
    [translatedNode, { original: "Original", translated: "번역문", pending: false }],
    [pendingNode, { original: "Pending source", translated: null, pending: true }],
  ]);

  assert.deepEqual(syncTrackedTranslationDisplay(tracked, states, false), {
    changed: 1,
    retained: 2,
    removed: 0,
  });
  assert.equal(translatedNode.nodeValue, "Original");
  assert.equal(states.get(translatedNode)?.translated, "번역문");

  assert.deepEqual(syncTrackedTranslationDisplay(tracked, states, true), {
    changed: 1,
    retained: 2,
    removed: 0,
  });
  assert.equal(translatedNode.nodeValue, "번역문");
  assert.equal(pendingNode.nodeValue, "Pending source");
});

test("웹 문단이 바뀌었으면 오래된 번역 기록을 즉시 재생하지 않는다", () => {
  const changedNode = { isConnected: true, nodeValue: "New source text" };
  const disconnectedNode = { isConnected: false, nodeValue: "번역문" };
  const tracked = new Set([changedNode, disconnectedNode]);
  const states = new WeakMap([
    [changedNode, { original: "Old source text", translated: "오래된 번역", pending: false }],
    [disconnectedNode, { original: "Original", translated: "번역문", pending: false }],
  ]);

  assert.deepEqual(syncTrackedTranslationDisplay(tracked, states, true), {
    changed: 0,
    retained: 0,
    removed: 2,
  });
  assert.equal(changedNode.nodeValue, "New source text");
  assert.equal(states.has(changedNode), false);
  assert.equal(tracked.size, 0);
});

test("사용자가 펼친 동적 문단은 기존 웹 번역 대기열보다 먼저 처리한다", () => {
  const queue = [{ id: "older-1" }, { id: "older-2" }];
  const expanded = [{ id: "expanded-1" }, { id: "expanded-2" }];

  addTranslationItems(queue, expanded, true);

  assert.deepEqual(queue.map((item) => item.id), [
    "expanded-1",
    "expanded-2",
    "older-1",
    "older-2",
  ]);
});

test("동적으로 교체된 X 게시물 텍스트는 이미 관찰 중인 게시물 블록을 다시 찾는다", () => {
  const block = {
    nodeType: 1,
    matches(selector) {
      return selector === "[data-testid='tweetText']";
    },
    closest() {
      return null;
    },
  };
  const nested = {
    nodeType: 1,
    matches() {
      return false;
    },
    closest(selector) {
      assert.equal(selector, "[data-testid='tweetText']");
      return block;
    },
  };
  const text = { nodeType: 3, parentElement: nested };

  assert.equal(closestTranslationBlock(text, "[data-testid='tweetText']"), block);
  assert.equal(closestTranslationBlock(nested, "[data-testid='tweetText']"), block);
});

test("사이트가 명시한 공개 안내 블록만 공통 내비게이션 제외를 우회한다", () => {
  const safeSelector = "nav.public-guide a[href^='https://example.com/']";
  const safeBlock = { matches: (selector) => selector === safeSelector };
  const otherBlock = { matches: () => false };
  const adapter = { exclusionBypassBlocks: [safeSelector] };

  assert.equal(isExplicitExclusionBypassBlock(safeBlock, adapter), true);
  assert.equal(isExplicitExclusionBypassBlock(otherBlock, adapter), false);
  assert.equal(isExplicitExclusionBypassBlock(safeBlock, null), false);
});

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

test("설정한 빠른 번역 전환키만 판정한다", () => {
  assert.equal(isQuickToggleShortcut({ key: "F4" }), true);
  assert.equal(isQuickToggleShortcut({ key: "Unidentified", code: "F4" }), true);
  assert.equal(isQuickToggleShortcut({ key: "F9" }, "F9"), true);
  assert.equal(isQuickToggleShortcut({ key: "F4" }, "F9"), false);
  assert.equal(
    isQuickToggleShortcut({ key: "k", ctrlKey: true, altKey: true }, "Ctrl+Alt+K"),
    true,
  );
  assert.equal(isQuickToggleShortcut({ key: "F4" }, ""), false);
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

test("긴 문서의 로컬 AI도 문단 묶음을 유지해 작은 추론이 연속되지 않게 한다", () => {
  const profile = webSchedulingProfile("balanced", false);

  assert.deepEqual(translationBatchLimits(profile, false, true), {
    maxItems: 24,
    maxChars: 16000,
  });
  assert.deepEqual(translationBatchLimits(profile, false, false), {
    maxItems: 24,
    maxChars: 16000,
  });
});

test("긴 문서에서도 외부 번역 서비스의 묶음 전송 한도는 유지한다", () => {
  const profile = webSchedulingProfile("balanced", true);

  assert.deepEqual(translationBatchLimits(profile, true, true), {
    maxItems: 32,
    maxChars: 32000,
  });
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

test("항목 제한보다 큰 문단은 원래 노드와 문단 ID를 유지한 채 요청을 나눈다", () => {
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

  const options = {
    maxItems: 24,
    maxChars: 16000,
    isCurrent: () => true,
    isNearViewport: () => true,
    onDiscard: () => assert.fail("현재 문단을 버리면 안 된다"),
  };
  const batch = takeTranslationBatch(queue, options);

  assert.deepEqual(batch, paragraph.slice(0, 24));
  assert.deepEqual(queue, [...paragraph.slice(24), ...nextParagraph]);
  const remaining = takeTranslationBatch(queue, options);
  const sent = [...batch, ...remaining];
  assert.deepEqual(sent, [...paragraph, ...nextParagraph]);
  sent.forEach((item, index) => assert.equal(item, [...paragraph, ...nextParagraph][index]));
  assert.deepEqual(queue, []);
});

for (const external of [false, true]) {
  test(`${external ? "외부" : "로컬"} 번역의 큰 문단은 문자 한도 내에서 기존 텍스트 노드 경계로 나눈다`, () => {
    const paragraph = Array.from({ length: 10 }, (_, index) => ({
      id: `long-${index}`,
      blockId: "long-paragraph",
      node: { index },
      text: String(index).repeat(2999),
    }));
    const queue = [...paragraph];
    const options = {
      maxItems: 24,
      maxChars: 10000,
      discardOversize: external,
      isCurrent: () => true,
      isNearViewport: () => true,
      onDiscard: () => assert.fail("한도 내로 나눌 수 있는 노드를 버리면 안 된다"),
    };
    const batches = [];
    while (queue.length > 0) {
      const batch = takeTranslationBatch(queue, options);
      assert.ok(batch.length > 0 && batch.length <= options.maxItems);
      assert.ok(batch.reduce((sum, item) => sum + item.text.length, 0) <= options.maxChars);
      batches.push(batch);
    }

    assert.deepEqual(batches.map((batch) => batch.length), [3, 3, 3, 1]);
    const sent = batches.flat();
    assert.deepEqual(sent, paragraph);
    sent.forEach((item, index) => assert.equal(item, paragraph[index]));
    assert.ok(sent.every((item) => item.blockId === "long-paragraph"));
  });
}

test("외부 번역의 큰 문단은 남은 페이지 전송 예산을 초과하지 않는다", () => {
  const paragraph = Array.from({ length: 10 }, (_, index) => ({
    id: `long-${index}`,
    blockId: "long-paragraph",
    text: "x".repeat(2999),
  }));
  const queue = [...paragraph];
  const discarded = [];
  const pageLimit = 25000;
  let sentChars = 0;
  const batches = [];
  while (queue.length > 0) {
    const batch = takeTranslationBatch(queue, {
      maxItems: 40,
      maxChars: Math.min(32000, pageLimit - sentChars),
      discardOversize: true,
      isCurrent: () => true,
      isNearViewport: () => true,
      onDiscard: (item) => discarded.push(item),
    });
    sentChars += batch.reduce((sum, item) => sum + item.text.length, 0);
    assert.ok(sentChars <= pageLimit);
    batches.push(batch);
  }

  assert.deepEqual(batches[0], paragraph.slice(0, 8));
  assert.deepEqual(batches[1], []);
  assert.equal(sentChars, 23992);
  assert.deepEqual(discarded, paragraph.slice(8));
});

test("남은 외부 예산보다 큰 단일 노드만 제외하고 같은 문단의 작은 노드는 보존한다", () => {
  const oversized = { id: "large", blockId: "paragraph", text: "too long" };
  const small = { id: "small", blockId: "paragraph", text: "abc" };
  const tail = { id: "tail", blockId: "paragraph", text: "de" };
  const queue = [oversized, small, tail];
  const discarded = [];
  const batch = takeTranslationBatch(queue, {
    maxItems: 24,
    maxChars: 5,
    discardOversize: true,
    isCurrent: () => true,
    isNearViewport: () => true,
    onDiscard: (item) => discarded.push(item),
  });

  assert.deepEqual(batch, [small, tail]);
  assert.deepEqual(discarded, [oversized]);
  assert.deepEqual(queue, []);
});

test("로컬 번역도 요청 한도를 넘는 단일 노드를 보내거나 대기열에 가두지 않는다", () => {
  const oversized = { id: "large", blockId: "paragraph", text: "too long" };
  const small = { id: "small", blockId: "paragraph", text: "abc" };
  const queue = [oversized, small];
  const discarded = [];
  const batch = takeTranslationBatch(queue, {
    maxItems: 24,
    maxChars: 5,
    discardOversize: false,
    isCurrent: () => true,
    isNearViewport: () => true,
    onDiscard: (item) => discarded.push(item),
  });

  assert.deepEqual(batch, [small]);
  assert.deepEqual(discarded, [oversized]);
  assert.deepEqual(queue, []);
});

test("큰 문단 분할 전 무효화되거나 화면 밖인 노드는 한 번만 제외한다", () => {
  const items = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    blockId: "paragraph",
    text: "1234",
  }));
  const queue = [...items];
  const discarded = [];
  const options = {
    maxItems: 2,
    maxChars: 8,
    discardOversize: true,
    isCurrent: (item) => item !== items[1],
    isNearViewport: (item) => item !== items[3],
    onDiscard: (item) => discarded.push(item),
  };

  const first = takeTranslationBatch(queue, options);
  assert.deepEqual(first, [items[0], items[2]]);
  assert.deepEqual(queue, [items[4]]);
  assert.deepEqual(takeTranslationBatch(queue, options), [items[4]]);
  assert.deepEqual(discarded, [items[1], items[3]]);
  assert.deepEqual(queue, []);
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
