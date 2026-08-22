import assert from "node:assert/strict";
import test from "node:test";

import {
  createLatestDictionaryRequestGate,
  dictionaryOverviewFingerprint,
} from "../dictionary-sync.mjs";

test("an older dictionary snapshot cannot replace a newer refresh", () => {
  const gate = createLatestDictionaryRequestGate();
  const olderRequest = gate.begin();
  const newerRequest = gate.begin();

  assert.equal(gate.isCurrent(olderRequest), false);
  assert.equal(gate.isCurrent(newerRequest), true);

  gate.invalidate();
  assert.equal(gate.isCurrent(newerRequest), false);
});

test("dictionary overview fingerprint changes when a visible entry changes", () => {
  const original = [{ id: 1, sourceTerm: "right", targetTerm: "옳다", updatedAt: 10 }];
  const edited = [{ id: 1, sourceTerm: "right", targetTerm: "오른쪽", updatedAt: 11 }];

  assert.notEqual(dictionaryOverviewFingerprint(original), dictionaryOverviewFingerprint(edited));
  assert.equal(dictionaryOverviewFingerprint(original), dictionaryOverviewFingerprint([...original]));
});
