from __future__ import annotations

import threading
import time
from pathlib import Path
from queue import Queue

import pytest

from discord_translate_overlay.cache import TranslationCache
from discord_translate_overlay.config import AppConfig
from discord_translate_overlay.experimental_dom import controller as dom_module
from discord_translate_overlay.experimental_dom.controller import (
    SNAPSHOT_SCRIPT,
    TRANSLATOR_LABELS,
    TranslationService,
    apply_script,
)
from discord_translate_overlay.models import Language
from discord_translate_overlay.translation.base import Translator
from discord_translate_overlay.translation.mock import MockTranslator


class RecordingTranslator(Translator):
    cache_namespace = "private-test:v1"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def translate(self, text: str, source: Language, target: Language) -> str:
        self.calls.append(text)
        return text.replace("こんにちは", "안녕하세요").replace(
            "誕生日系のイベント", "생일 관련 이벤트"
        )


class LocalLifecycleTranslator(RecordingTranslator):
    def __init__(self) -> None:
        super().__init__()
        self.prepare_started = threading.Event()
        self.close_calls = 0

    def model_is_ready(self) -> bool:
        return True

    def prepare(self) -> None:
        self.prepare_started.set()

    def close(self) -> None:
        self.close_calls += 1


class BatchRecordingTranslator(RecordingTranslator):
    def __init__(self) -> None:
        super().__init__()
        self.batch_calls: list[list[str]] = []

    def translate_many(
        self,
        items: list[tuple[str, Language]],
        target: Language,
    ) -> list[str]:
        del target
        texts = [text for text, _source in items]
        self.batch_calls.append(texts)
        return [
            text.replace("こんにちは", "안녕하세요").replace("Hello", "안녕")
            for text in texts
        ]


def test_same_language_is_not_translated(tmp_path: Path) -> None:
    translator = RecordingTranslator()
    cache = TranslationCache(tmp_path / "cache.db")
    service = TranslationService(translator, cache)

    assert service.translate("이미 한국어야", Language.KOREAN) == "이미 한국어야"
    assert translator.calls == []
    cache.close()


@pytest.mark.parametrize(
    ("target", "source_text", "expected_prefix"),
    [
        (Language.KOREAN, "Hello", "[ko]"),
        (Language.JAPANESE, "안녕하세요", "[ja]"),
        (Language.ENGLISH, "こんにちは", "[en]"),
        (Language.CHINESE_SIMPLIFIED, "Hello", "[zh]"),
        (Language.CHINESE_TRADITIONAL, "Hello", "[zh-Hant]"),
    ],
)
def test_dom_translation_uses_every_selected_display_language(
    tmp_path: Path,
    target: Language,
    source_text: str,
    expected_prefix: str,
) -> None:
    cache = TranslationCache(tmp_path / f"target-{target.value}.db")
    service = TranslationService(MockTranslator(), cache)

    assert service.translate(source_text, target).startswith(expected_prefix)
    cache.close()


def test_emoji_and_mention_are_preserved_and_result_is_cached(tmp_path: Path) -> None:
    translator = RecordingTranslator()
    cache = TranslationCache(tmp_path / "cache.db")
    service = TranslationService(translator, cache)
    source = "@everyone こんにちは 🌸"

    assert service.translate(source, Language.KOREAN) == "@everyone 안녕하세요 🌸"
    assert service.translate(source, Language.KOREAN) == "@everyone 안녕하세요 🌸"
    assert len(translator.calls) == 1
    assert "@everyone" not in translator.calls[0]
    assert "🌸" not in translator.calls[0]
    cache.close()


def test_translation_service_batches_uncached_messages_and_reuses_cache(tmp_path: Path) -> None:
    translator = BatchRecordingTranslator()
    cache = TranslationCache(tmp_path / "batch-cache.db")
    service = TranslationService(translator, cache)
    messages = ["@everyone こんにちは 🌸", "Hello friend"]

    assert service.translate_many(messages, Language.KOREAN) == [
        "@everyone 안녕하세요 🌸",
        "안녕 friend",
    ]
    assert len(translator.batch_calls) == 1
    assert len(translator.batch_calls[0]) == 2
    assert "@everyone" not in translator.batch_calls[0][0]
    assert "🌸" not in translator.batch_calls[0][0]

    assert service.translate_many(messages, Language.KOREAN) == [
        "@everyone 안녕하세요 🌸",
        "안녕 friend",
    ]
    assert len(translator.batch_calls) == 1
    cache.close()


def test_dom_worker_drains_visible_messages_into_one_service_batch(monkeypatch) -> None:
    class BatchService:
        def __init__(self) -> None:
            self.single_calls: list[str] = []
            self.batch_calls: list[list[str]] = []

        def translate(self, text: str, target: Language) -> str:
            del target
            self.single_calls.append(text)
            return f"번역:{text}"

        def translate_many(self, texts: list[str], target: Language) -> list[str]:
            del target
            self.batch_calls.append(texts)
            return [f"번역:{text}" for text in texts]

    monkeypatch.setattr(dom_module, "TRANSLATION_BATCH_DEBOUNCE_SECONDS", 0.02)
    controller = dom_module.DomTranslationController.__new__(
        dom_module.DomTranslationController
    )
    controller.stop_event = threading.Event()
    controller.translation_generation = 4
    controller.service_lock = threading.RLock()
    controller.service = BatchService()
    controller.jobs = Queue()
    controller.results = Queue()
    worker = threading.Thread(target=controller._worker)
    worker.start()
    for index, text in enumerate(("first", "second", "third")):
        controller.jobs.put(
            dom_module.TranslationJob(
                dom_module.DomPart("message", f"message-{index}", 0, text),
                Language.KOREAN,
                4,
            )
        )
    controller.jobs.put(None)
    worker.join(timeout=1.0)

    assert not worker.is_alive()
    assert controller.service.single_calls == []
    assert controller.service.batch_calls == [["first", "second", "third"]]
    assert [controller.results.get_nowait().translated for _ in range(3)] == [
        "번역:first",
        "번역:second",
        "번역:third",
    ]


def test_apply_script_serializes_multilingual_text_without_html_injection() -> None:
    script = apply_script(
        [{"kind": "message", "id": "message-content-1", "index": 0, "text": "한국어 <b>"}]
    )

    assert '"한국어 <b>"' in script
    assert "innerHTML" not in script
    assert "node.nodeValue = change.text" in script


def test_heading_change_uses_a_unique_dom_locator() -> None:
    script = apply_script(
        [{"kind": "heading", "id": "heading-1", "index": 0, "text": "공지"}]
    )

    assert "data-dto-heading-id" in script
    assert "change.kind === 'heading'" in script


def test_duplicate_discord_message_ids_get_unique_dom_locators() -> None:
    assert "ensureRootId(root, 'data-dto-message-id', 'message')" in SNAPSHOT_SCRIPT
    assert "root.setAttribute('data-dto-message-id', root.id)" not in SNAPSHOT_SCRIPT


def test_forum_threads_post_titles_and_preview_headings_are_collected() -> None:
    assert "querySelectorAll('[data-list-item-id^=\"channels___\"]')" in SNAPSHOT_SCRIPT
    assert "postTitleText" in SNAPSHOT_SCRIPT
    assert "data-dto-forum-title-id" in SNAPSHOT_SCRIPT
    assert "data-dto-heading-id" in SNAPSHOT_SCRIPT

    script = apply_script(
        [
            {"kind": "forum-title", "id": "forum-title-1", "index": 0, "text": "제목"},
            {"kind": "heading", "id": "heading-1", "index": 0, "text": "녹화부"},
        ]
    )
    assert "change.kind === 'forum-title'" in script
    assert "change.kind === 'heading'" in script


def test_reply_preview_has_a_unique_locator_separate_from_message_body() -> None:
    assert "closest('[id^=\"message-reply-context-\"]')" in SNAPSHOT_SCRIPT
    assert "parts('reply'" in SNAPSHOT_SCRIPT
    assert "data-dto-reply-id" in SNAPSHOT_SCRIPT
    assert "change.kind === 'reply'" in apply_script(
        [{"kind": "reply", "id": "reply-1", "index": 0, "text": "번역"}]
    )


def test_interactive_mentions_remain_protected_while_surrounding_text_is_eligible() -> None:
    assert "[role=\"button\"]" in SNAPSHOT_SCRIPT
    assert "root.contains(protectedParent)" in SNAPSHOT_SCRIPT


def test_channel_contexts_are_collected_and_applied_with_stable_locators() -> None:
    for selector_fragment in (
        "guildDropdown_",
        "topic_",
        "description_",
        "headerSubtitle_",
        "bodyInner_",
    ):
        assert selector_fragment in SNAPSHOT_SCRIPT
    assert "data-dto-context-id" in SNAPSHOT_SCRIPT

    script = apply_script(
        [{"kind": "context", "id": "context-1", "index": 0, "text": "번역"}]
    )
    assert "change.kind === 'context'" in script
    assert "data-dto-context-id" in script


def test_japanese_channel_name_inside_korean_ui_text_is_translated(tmp_path: Path) -> None:
    translator = RecordingTranslator()
    cache = TranslationCache(tmp_path / "mixed-context-cache.db")
    service = TranslationService(translator, cache)
    source = "#誕生日系のイベント에 오신 걸 환영합니다!"

    assert service.translate(source, Language.KOREAN) == (
        "#생일 관련 이벤트에 오신 걸 환영합니다!"
    )
    assert translator.calls == ["誕生日系のイベント"]
    cache.close()


def test_tray_exposes_supported_translation_engines() -> None:
    assert set(TRANSLATOR_LABELS) == {
        "hymt_1_8b",
        "hymt_7b",
        "chatgpt",
        "claude",
        "gemini",
        "deepl",
        "mock",
        "original",
    }


def test_cdp_restart_prompt_requires_two_consecutive_failures() -> None:
    controller = dom_module.DomTranslationController.__new__(
        dom_module.DomTranslationController
    )
    controller.enabled = True
    controller.connection_issues = Queue()
    controller._consecutive_connection_failures = 0
    controller._connection_issue_reported = False

    controller._record_connection_failure(RuntimeError("port closed"))
    assert controller.connection_issues.empty()

    controller._record_connection_failure(RuntimeError("renderer unavailable"))
    assert controller.connection_issues.get_nowait() == "renderer unavailable"

    controller._record_connection_failure(RuntimeError("duplicate"))
    assert controller.connection_issues.empty()


def test_cdp_restart_prompt_is_suppressed_while_translation_is_off() -> None:
    controller = dom_module.DomTranslationController.__new__(
        dom_module.DomTranslationController
    )
    controller.enabled = False
    controller.connection_issues = Queue()
    controller._consecutive_connection_failures = 0
    controller._connection_issue_reported = False

    controller._record_connection_failure(RuntimeError("port closed"))
    controller._record_connection_failure(RuntimeError("still closed"))

    assert controller.connection_issues.empty()


def test_successful_cdp_connection_resets_restart_prompt_guard() -> None:
    controller = dom_module.DomTranslationController.__new__(
        dom_module.DomTranslationController
    )
    controller._consecutive_connection_failures = 2
    controller._connection_issue_reported = True

    controller._mark_connection_ready()

    assert controller._consecutive_connection_failures == 0
    assert not controller._connection_issue_reported


def test_local_model_is_prepared_in_background_when_warm_mode_is_enabled(
    monkeypatch, tmp_path: Path
) -> None:
    translator = LocalLifecycleTranslator()
    monkeypatch.setattr(dom_module, "make_translator", lambda _config, **_kwargs: translator)
    monkeypatch.setattr(
        dom_module,
        "TranslationCache",
        lambda: TranslationCache(tmp_path / "warm-start-cache.db"),
    )
    controller = dom_module.DomTranslationController(
        AppConfig(translator="hymt_7b", enabled=False, keep_local_model_warm=True)
    )
    try:
        assert translator.prepare_started.wait(timeout=1.0)
    finally:
        controller.close()


def test_disabling_translation_releases_local_model_when_warm_mode_is_disabled(
    monkeypatch, tmp_path: Path
) -> None:
    translator = LocalLifecycleTranslator()
    monkeypatch.setattr(dom_module, "make_translator", lambda _config, **_kwargs: translator)
    monkeypatch.setattr(
        dom_module,
        "TranslationCache",
        lambda: TranslationCache(tmp_path / "cold-toggle-cache.db"),
    )
    monkeypatch.setattr(dom_module, "save_config", lambda _config: None)
    controller = dom_module.DomTranslationController(
        AppConfig(translator="hymt_7b", enabled=True, keep_local_model_warm=False)
    )
    try:
        controller._set_enabled(False)
        assert translator.close_calls == 1
    finally:
        controller.close()


def test_disabling_warm_mode_releases_model_while_translation_is_already_off(
    monkeypatch, tmp_path: Path
) -> None:
    translator = LocalLifecycleTranslator()
    monkeypatch.setattr(dom_module, "make_translator", lambda _config, **_kwargs: translator)
    monkeypatch.setattr(
        dom_module,
        "TranslationCache",
        lambda: TranslationCache(tmp_path / "cold-setting-cache.db"),
    )
    monkeypatch.setattr(dom_module, "save_config", lambda _config: None)
    controller = dom_module.DomTranslationController(
        AppConfig(translator="hymt_7b", enabled=False, keep_local_model_warm=True)
    )
    try:
        assert translator.prepare_started.wait(timeout=1.0)
        controller.request_config(
            AppConfig(
                translator="hymt_7b",
                enabled=False,
                keep_local_model_warm=False,
            )
        )
        controller._consume_controls()

        assert translator.close_calls == 1
    finally:
        controller.close()


def test_model_switch_replaces_service_and_persists_choice(
    monkeypatch, tmp_path: Path
) -> None:
    created: list[RecordingTranslator] = []
    saved: list[str] = []

    def fake_make(_config, *, name=None):
        translator = RecordingTranslator()
        translator.cache_namespace = f"test:{name or 'initial'}"
        created.append(translator)
        return translator

    monkeypatch.setattr(dom_module, "make_translator", fake_make)
    monkeypatch.setattr(
        dom_module,
        "TranslationCache",
        lambda: TranslationCache(tmp_path / "controller-cache.db"),
    )
    monkeypatch.setattr(dom_module, "save_config", lambda config: saved.append(config.translator))
    controller = dom_module.DomTranslationController(AppConfig(translator="original"))
    try:
        controller.request_translator("hymt_7b")
        controller._consume_controls()
        assert controller.config.translator == "hymt_7b"
        assert controller.service.translator is created[-1]
        assert saved == ["hymt_7b"]
    finally:
        controller.close()


def test_mock_model_uses_mock_translator() -> None:
    translator = dom_module.make_translator(AppConfig(translator="mock"))

    assert translator.cache_namespace == "mock:v1"


def test_capture_frequency_controls_dom_poll_interval() -> None:
    assert dom_module._poll_interval_seconds(20) == pytest.approx(0.05)
    assert dom_module._poll_interval_seconds(8) == pytest.approx(0.125)
    assert dom_module._poll_interval_seconds(1) == pytest.approx(0.5)
    assert dom_module._poll_interval_seconds(200) == pytest.approx(0.05)


def test_speech_style_switch_rebuilds_translator_and_persists_choice(
    monkeypatch, tmp_path: Path
) -> None:
    created_styles: list[str] = []
    saved_styles: list[str] = []

    def fake_make(config, *, name=None):
        del name
        created_styles.append(config.speech_style)
        return RecordingTranslator()

    monkeypatch.setattr(dom_module, "make_translator", fake_make)
    monkeypatch.setattr(
        dom_module,
        "TranslationCache",
        lambda: TranslationCache(tmp_path / "speech-style-cache.db"),
    )
    monkeypatch.setattr(
        dom_module,
        "save_config",
        lambda config: saved_styles.append(config.speech_style),
    )
    controller = dom_module.DomTranslationController(AppConfig(translator="original"))
    try:
        controller.request_speech_style("casual")
        controller._consume_controls()
        assert controller.config.speech_style == "casual"
        assert created_styles == ["auto", "casual"]
        assert saved_styles == ["casual"]
    finally:
        controller.close()


class PreparingTranslator(RecordingTranslator):
    def __init__(self) -> None:
        super().__init__()
        self.prepare_started = threading.Event()
        self.allow_ready = threading.Event()

    def model_is_ready(self) -> bool:
        return False

    def prepare(self) -> None:
        self.prepare_started.set()
        assert self.allow_ready.wait(timeout=2.0)


def test_slow_model_prepares_in_background_while_old_model_stays_active(
    monkeypatch, tmp_path: Path
) -> None:
    original = RecordingTranslator()
    slow = PreparingTranslator()

    def fake_make(_config, *, name=None):
        return slow if name == "hymt_7b" else original

    monkeypatch.setattr(dom_module, "make_translator", fake_make)
    monkeypatch.setattr(
        dom_module,
        "TranslationCache",
        lambda: TranslationCache(tmp_path / "background-cache.db"),
    )
    monkeypatch.setattr(dom_module, "save_config", lambda _config: None)
    controller = dom_module.DomTranslationController(AppConfig(translator="original"))
    try:
        controller.request_translator("hymt_7b")
        controller._consume_controls()
        assert slow.prepare_started.wait(timeout=1.0)
        assert controller.translator is original
        assert controller.active_translator_name == "original"

        slow.allow_ready.set()
        deadline = time.monotonic() + 1.0
        while controller.controls.empty() and time.monotonic() < deadline:
            time.sleep(0.01)
        controller._consume_controls()
        assert controller.translator is slow
        assert controller.active_translator_name == "hymt_7b"
    finally:
        controller.close()
