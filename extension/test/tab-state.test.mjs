import assert from "node:assert/strict";
import test from "node:test";
import "../tab-state.js";

const { createTabTranslationState } = globalThis.NudeNyangTabTranslationState;

function fakeApi() {
  const values = {};
  return {
    storage: {
      session: {
        get(defaults, callback) {
          callback({ ...defaults, ...values });
        },
        set(update, callback) {
          Object.assign(values, update);
          callback();
        },
        remove(key, callback) {
          delete values[key];
          callback();
        },
      },
    },
  };
}

test("탭 번역 상태는 백그라운드가 다시 만들어져도 세션 저장소에서 복원된다", async () => {
  const api = fakeApi();
  const first = createTabTranslationState(api);
  assert.equal(await first.get(17), null);
  assert.equal(await first.set(17, true), true);
  assert.equal(await first.set(23, false), false);

  const restored = createTabTranslationState(api);
  assert.equal(await restored.get(17), true);
  assert.equal(await restored.get(23), false);
});

test("탭을 닫으면 저장된 번역 상태를 제거한다", async () => {
  const api = fakeApi();
  const state = createTabTranslationState(api);
  await state.set(31, true);
  await state.clear(31);
  assert.equal(await createTabTranslationState(api).get(31), null);
});
