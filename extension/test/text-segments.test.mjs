import assert from "node:assert/strict";
import test from "node:test";
import "../text-segments.js";

const {
  splitTranslationText, createTextRecord, recordMatchesItem, acceptTextSegment, cancelTextRecord,
} = globalThis.NudeNyangTextSegments;

function itemFor(record, segmentIndex, overrides = {}) {
  return {
    id: `${record.itemId}:${segmentIndex}`,
    recordId: record.itemId,
    segmentIndex,
    epoch: record.epoch,
    text: record.segments[segmentIndex],
    ...overrides,
  };
}

test("하나라도 미완료인 조각이 있으면 표시만 허용하고 전체 노드를 재사용 캐시에서 제외한다", () => {
  const record = createTextRecord("first second", "quality", 1, 6);
  assert.equal(acceptTextSegment(record, itemFor(record, 0, { cacheable: false }), "first "), true);
  assert.equal(acceptTextSegment(record, itemFor(record, 1), "둘째"), true);
  assert.equal(record.pending, false);
  assert.equal(record.translated, "first 둘째");
  assert.equal(record.cacheable, false);
});

test("한 글자와 한도 안의 텍스트는 원래 문자열 그대로 한 항목에 보존한다", () => {
  for (const original of ["夢", "を", "a", "🚀", " \t원문\r\n", "字".repeat(4000)]) {
    assert.deepEqual(splitTranslationText(original), [original]);
  }
});

test("빈 문자열과 공백만 있는 노드는 외부 번역 항목을 만들지 않는다", () => {
  for (const original of ["", " ", "\r\n\t", "\u00a0\u2003", " ".repeat(9000)]) {
    assert.deepEqual(splitTranslationText(original), []);
    const record = createTextRecord(original, "empty", 1);
    assert.equal(record.original, original);
    assert.deepEqual(record.segments, []);
    assert.equal(record.pending, false);
    assert.equal(record.translated, null);
  }
});

test("긴 단일 노드도 항목 한도를 지키며 공백과 줄바꿈을 빠짐없이 분할한다", () => {
  const original = ` \t${"긴 문장입니다. Next line!\r\n".repeat(500)}끝\n`;
  const segments = splitTranslationText(original);
  assert.ok(segments.length > 1);
  assert.ok(segments.every((segment) => segment.length > 0 && segment.length <= 4000));
  assert.equal(segments.join(""), original);
});

test("충분히 긴 문장 경계와 공백 경계를 단어 중간보다 우선한다", () => {
  assert.deepEqual(splitTranslationText("First sentence. Second sentence. Third sentence.", 24), [
    "First sentence. ", "Second sentence. ", "Third sentence.",
  ]);
  assert.deepEqual(splitTranslationText("alpha beta gamma delta", 14), ["alpha beta ", "gamma delta"]);
  assert.deepEqual(splitTranslationText("最初の説明です。次の説明です。最後の説明です。", 14), [
    "最初の説明です。", "次の説明です。", "最後の説明です。",
  ]);
});

test("문장 경계가 없거나 아주 앞에 있어도 진행하며 원문을 버리지 않는다", () => {
  for (const original of ["字".repeat(12001), `A. ${"x".repeat(12000)}`, "a b c d e f g h i j"]) {
    const segments = splitTranslationText(original, 17);
    assert.ok(segments.every((segment) => segment.length > 0 && segment.length <= 17));
    assert.equal(segments.join(""), original);
  }
});

test("UTF-16 한도를 넘어서는 서로게이트 쌍을 끊지 않는다", () => {
  for (const original of [
    `${"a".repeat(3999)}🚀끝`,
    "🚀".repeat(4001),
    `한국어 ${"𠀀😀👨‍👩‍👧‍👦e\u0301 ".repeat(350)}`,
  ]) {
    const segments = splitTranslationText(original);
    assert.equal(segments.join(""), original);
    for (const segment of segments) {
      assert.ok(segment.length <= 4000);
      assert.ok(segment.isWellFormed(), "a transport boundary must not split a surrogate pair");
    }
  }
  assert.deepEqual(splitTranslationText("abc", 1), ["a", "b", "c"]);
  assert.throws(() => splitTranslationText("a🚀b", 1), RangeError);
});

test("유효하지 않은 한도와 비문자열 입력은 무한 분할 대신 즉시 거부한다", () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity, "4000"]) {
    assert.throws(() => splitTranslationText("source", limit), RangeError);
  }
  for (const value of [undefined, null, 17, {}]) {
    assert.throws(() => splitTranslationText(value), TypeError);
  }
});

test("각 DOM 노드 기록은 독립적인 원문 조각과 응답 저장소를 가진다", () => {
  const first = createTextRecord("alpha beta gamma delta", "node-1", 7, 8);
  const second = createTextRecord("alpha beta gamma delta", "node-2", 7, 8);
  assert.equal(first.original, "alpha beta gamma delta");
  assert.equal(first.itemId, "node-1");
  assert.equal(first.epoch, 7);
  assert.equal(first.pending, true);
  assert.equal(first.translated, null);
  assert.equal(first.invalid, false);
  assert.notEqual(first.segments, second.segments);
  assert.notEqual(first.partial, second.partial);
  acceptTextSegment(first, itemFor(first, 0), "알파");
  assert.equal(second.partial.size, 0);
});

test("조각 식별자는 원문·노드 기록·세대·인덱스를 모두 확인한다", () => {
  const record = createTextRecord("alpha beta gamma delta", "node", 7, 8);
  assert.equal(recordMatchesItem(record, itemFor(record, 0)), true);
  for (const overrides of [
    { recordId: "other-node" }, { epoch: 8 }, { segmentIndex: -1 },
    { segmentIndex: 0.5 }, { segmentIndex: record.segments.length },
    { id: "node" }, { id: "node:1" }, { text: "changed source" },
  ]) {
    assert.equal(recordMatchesItem(record, itemFor(record, 0, overrides)), false);
  }
  assert.equal(recordMatchesItem(record, null), false);
  assert.equal(recordMatchesItem(null, itemFor(record, 0)), false);
});

test("응답 순서가 달라도 모든 조각이 모이기 전에는 표시할 번역을 만들지 않는다", () => {
  const record = createTextRecord("alpha beta gamma delta", "node", 7, 8);
  assert.deepEqual(record.segments, ["alpha ", "beta ", "gamma ", "delta"]);
  for (const [index, translated] of [[3, "델타"], [1, "베타"], [0, "알파"]]) {
    assert.equal(acceptTextSegment(record, itemFor(record, index), translated), true);
    assert.equal(record.pending, true);
    assert.equal(record.translated, null);
  }
  assert.equal(acceptTextSegment(record, itemFor(record, 2), "감마"), true);
  assert.equal(record.pending, false);
  assert.equal(record.translated, "알파 베타 감마 델타");
  assert.equal(record.original, "alpha beta gamma delta");
});

test("중복 응답은 먼저 받은 조각을 덮거나 완료 조건을 앞당기지 않는다", () => {
  const record = createTextRecord("alpha beta gamma delta", "node", 7, 8);
  const item = itemFor(record, 0);
  assert.equal(acceptTextSegment(record, item, "알파"), true);
  assert.equal(acceptTextSegment(record, item, "잘못된 중복"), false);
  assert.equal(record.partial.size, 1);
  assert.equal(record.partial.get(0), "알파 ");
  assert.equal(record.translated, null);
  for (const index of [1, 2, 3]) acceptTextSegment(record, itemFor(record, index), `번역${index}`);
  const complete = record.translated;
  assert.equal(recordMatchesItem(record, item), true);
  assert.equal(acceptTextSegment(record, item, "완료 후 중복"), false);
  assert.equal(record.translated, complete);
});

test("오래된 응답은 현재 기록의 부분 결과와 완료 상태를 변경하지 않는다", () => {
  const record = createTextRecord("alpha beta gamma delta", "node", 7, 8);
  acceptTextSegment(record, itemFor(record, 0), "알파");
  for (const overrides of [{ epoch: 6 }, { recordId: "old-node" }, { text: "old source" }]) {
    assert.equal(acceptTextSegment(record, itemFor(record, 1, overrides), "오래된 결과"), false);
  }
  assert.deepEqual([...record.partial], [[0, "알파 "]]);
  assert.equal(record.pending, true);
  assert.equal(record.invalid, false);
});

test("번역기가 공백을 정리해도 분할 경계의 원래 공백과 줄바꿈을 보전한다", () => {
  const record = createTextRecord(" \talpha  beta\r\n", "node", 7, 9);
  assert.deepEqual(record.segments, [" \talpha  ", "beta\r\n"]);
  acceptTextSegment(record, itemFor(record, 1), " \n번역 베타 \t");
  acceptTextSegment(record, itemFor(record, 0), "\n 번역 알파  \t");
  assert.equal(record.translated, " \t번역 알파  번역 베타\r\n");
});

test("분할하지 않은 짧은 노드는 기존 번역 응답의 표시 문자열을 그대로 유지한다", () => {
  const record = createTextRecord(" source ", "node", 7);
  const response = "\n 번역( source ) \t";
  acceptTextSegment(record, itemFor(record, 0), response);
  assert.equal(record.translated, response);
});

test("아주 긴 공백 구간은 외부 요청 없이 채우고 나머지 결과와 정확히 합친다", () => {
  const original = `a${" ".repeat(10)}b`;
  const record = createTextRecord(original, "node", 7, 4);
  assert.deepEqual(record.segments, ["a   ", "    ", "   b"]);
  assert.deepEqual([...record.partial], [[1, "    "]]);
  const queued = record.segments.flatMap((segment, index) => segment.trim() ? [itemFor(record, index)] : []);
  assert.equal(queued.length, 2);
  assert.equal(acceptTextSegment(record, itemFor(record, 1), "공백을 번역하면 안 됨"), false);
  acceptTextSegment(record, queued[1], "뒤");
  assert.equal(record.translated, null);
  acceptTextSegment(record, queued[0], "앞");
  assert.equal(record.translated, `앞${" ".repeat(10)}뒤`);
});

test("일부 응답 누락·오류는 기록 전체를 무효화하며 늦은 형제 결과를 붙이지 않는다", () => {
  for (const missing of [undefined, null, "", " \r\n", 1]) {
    const record = createTextRecord("alpha beta gamma delta", "node", 7, 8);
    acceptTextSegment(record, itemFor(record, 0), "알파");
    assert.equal(acceptTextSegment(record, itemFor(record, 1), missing), false);
    assert.equal(record.invalid, true);
    assert.equal(record.pending, false);
    assert.equal(record.translated, null);
    assert.equal(record.partial.size, 0);
    assert.equal(recordMatchesItem(record, itemFor(record, 2)), false);
    assert.equal(acceptTextSegment(record, itemFor(record, 2), "늦은 결과"), false);
  }
});

test("오래된 항목의 빈 응답은 새 기록을 취소하지 않는다", () => {
  const record = createTextRecord("alpha beta gamma delta", "node", 7, 8);
  assert.equal(acceptTextSegment(record, itemFor(record, 0, { epoch: 6 }), undefined), false);
  assert.equal(record.invalid, false);
  assert.equal(record.pending, true);
});

test("명시적 취소는 부분 결과와 완료 결과를 비우되 복원용 원문은 보존한다", () => {
  for (const complete of [false, true]) {
    const record = createTextRecord("alpha beta", "node", 7, 6);
    acceptTextSegment(record, itemFor(record, 0), "알파");
    if (complete) acceptTextSegment(record, itemFor(record, 1), "베타");
    assert.equal(cancelTextRecord(record), true);
    assert.equal(cancelTextRecord(record), false);
    assert.equal(record.original, "alpha beta");
    assert.equal(record.segments.join(""), record.original);
    assert.equal(record.translated, null);
    assert.equal(record.pending, false);
    assert.equal(record.invalid, true);
    assert.equal(record.partial.size, 0);
    assert.equal(acceptTextSegment(record, itemFor(record, 1), "늦은 결과"), false);
  }
});
