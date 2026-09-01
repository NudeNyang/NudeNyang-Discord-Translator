import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const domSource = readFileSync(new URL("../../src-tauri/src/dom.rs", import.meta.url), "utf8");
const snapshotMatch = domSource.match(
  /pub const SNAPSHOT_SCRIPT: &str = r#"\r?\n([\s\S]*?)\r?\n"#;/,
);

assert.ok(snapshotMatch, "Rust 소스에서 Discord DOM 스냅샷 스크립트를 찾을 수 있어야 해");
const snapshotScript = snapshotMatch[1];

function snapshot(html) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://discord.com/channels/1/2",
  });
  const { window } = dom;
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: 1200 },
    innerHeight: { configurable: true, value: 900 },
  });
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const isButton = this.matches?.("button,[role=button]");
    return {
      width: isButton ? 260 : 600,
      height: isButton ? 52 : 500,
      top: 20,
      right: 620,
      bottom: isButton ? 72 : 520,
      left: 20,
      x: 20,
      y: 20,
      toJSON() {},
    };
  };
  return window.eval(snapshotScript);
}

test("통화·방송 참가자 이름은 넓은 화면 문구가 아니라 닉네임으로만 분류한다", () => {
  const result = snapshot(`
    <main class="callContainer_test">
      <h2 class="title__test">방송 보기</h2>
      <div class="videoGrid_test">
        <div class="participant_test">
          <span class="participantName_test">だねん</span>
        </div>
      </div>
      <button>마이크</button>
      <button>카메라</button>
      <button>나가기</button>
    </main>
  `);

  const nameParts = result.parts.filter((part) => part.text === "だねん");
  assert.equal(nameParts.length, 1);
  assert.equal(nameParts[0].kind, "nickname");
});

test("방송 화면 제목에 합성된 참가자 이름도 닉네임으로 분류한다", () => {
  const result = snapshot(`
    <main class="pictureInPictureVideo_e4cb9a">
      <div class="videoControls_e4cb9a">
        <div class="topControls_e4cb9a">
          <div class="headerTitle_e4cb9a">
            <h2 class="headerText_e4cb9a">だねん님의 화면</h2>
          </div>
        </div>
      </div>
      <button>마이크</button>
      <button>카메라</button>
      <button>나가기</button>
    </main>
  `);

  const titleParts = result.parts.filter((part) => part.text === "だねん님의 화면");
  assert.equal(titleParts.length, 1);
  assert.equal(titleParts[0].kind, "nickname");
});

test("메시지 밖의 주요 사용자 이름 표면도 닉네임 설정 경계를 공유한다", () => {
  const result = snapshot(`
    <aside>
      <div class="voiceUser_test"><span class="name_test">Voice Friend</span></div>
      <div data-list-item-id="members-1___2"><span class="name_test">Guild Friend</span></div>
    </aside>
  `);

  for (const text of ["Voice Friend", "Guild Friend"]) {
    const parts = result.parts.filter((part) => part.text === text);
    assert.equal(parts.length, 1, `${text}는 한 번만 수집되어야 해`);
    assert.equal(parts[0].kind, "nickname", `${text}는 닉네임으로 분류되어야 해`);
  }
});

test("프로필 소개와 상태는 수집하되 표시 이름은 닉네임 경계를 유지한다", () => {
  const result = snapshot(`
    <section role="dialog" aria-label="User Profile">
      <img src="https://cdn.discordapp.com/avatars/123/avatar.png">
      <h2 class="nickname_test">ねう</h2>
      <div class="username_test">101neu</div>
      <div class="bio_test">今日はとても幸せです</div>
      <div class="customStatus_test">ゲームを遊んでいます</div>
      <button>메시지</button>
    </section>
  `);

  const nicknameParts = result.parts.filter(part => ["ねう", "101neu"].includes(part.text));
  assert.equal(nicknameParts.length, 2);
  assert.ok(nicknameParts.every(part => part.kind === "nickname"));

  for (const text of ["今日はとても幸せです", "ゲームを遊んでいます"]) {
    const parts = result.parts.filter(part => part.text === text);
    assert.equal(parts.length, 1, `${text}는 한 번만 수집되어야 해`);
    assert.equal(parts[0].kind, "profile-context");
  }
  assert.equal(result.parts.some(part => part.text === "메시지"), false);
});
