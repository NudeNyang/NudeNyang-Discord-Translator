from pathlib import Path
from types import SimpleNamespace

from discord_translate_overlay.models import Language
from discord_translate_overlay.translation import hymt as hymt_module
from discord_translate_overlay.translation.hymt import (
    HyMtTranslator,
    _rewrite_style_prompt,
    detect_speech_style,
)


def test_hymt_uses_register_aware_prompt_and_preserves_markers_locally(
    monkeypatch, tmp_path
) -> None:
    captured = []
    model = tmp_path / "model.gguf"
    model.write_bytes(b"test")
    server = tmp_path / "llama-server.exe"
    server.write_bytes(b"test")
    translator = HyMtTranslator(model_path=model, server_path=server)
    translator._port = 32123
    monkeypatch.setattr(translator, "_ensure_server", lambda: None)

    def fake_post(url, *, json, timeout):
        captured.append((url, json, timeout))
        prompt = json["messages"][0]["content"]
        translated = "안녕하세요" if "Hello" in prompt else "친구"
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "choices": [
                    {"message": {"content": translated}}
                ]
            },
        )

    monkeypatch.setattr(hymt_module.httpx, "post", fake_post)
    result = translator.translate(
        "Hello ZXQKEEP000QXZ friend", Language.ENGLISH, Language.KOREAN
    )

    assert result == "안녕하세요 ZXQKEEP000QXZ 친구"
    assert len(captured) == 2
    assert all(item[0] == "http://127.0.0.1:32123/v1/chat/completions" for item in captured)
    prompts = [item[1]["messages"][0]["content"] for item in captured]
    assert all("text into Korean." in prompt for prompt in prompts)
    assert all("preserve every piece of information" in prompt for prompt in prompts)
    assert all("Preserve line breaks" not in prompt for prompt in prompts)
    assert all(item[1]["temperature"] == 0.2 for item in captured)
    assert all(item[1]["repeat_penalty"] == 1.05 for item in captured)


def test_hymt_removes_translated_instruction_echo(monkeypatch, tmp_path) -> None:
    model = tmp_path / "model.gguf"
    model.write_bytes(b"test")
    server = tmp_path / "llama-server.exe"
    server.write_bytes(b"test")
    translator = HyMtTranslator(model_path=model, server_path=server)
    translator._port = 32123
    monkeypatch.setattr(translator, "_ensure_server", lambda: None)

    def fake_post(url, *, json, timeout):
        del url, json, timeout
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "choices": [
                    {
                        "message": {
                            "content": (
                                "줄바꿈, URL, ZXQKEEP로 시작하는 모든 단어를 유지하세요.\n"
                                "사용자명, 이모지, 제품명은 번역하지 마세요.\n"
                                "Discord 채팅 메시지에 적합한 표현을 사용하세요.\n\n"
                                "안녕하세요"
                            )
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(hymt_module.httpx, "post", fake_post)
    assert translator.translate("Hello", Language.ENGLISH, Language.KOREAN) == "안녕하세요"


def test_hymt_does_not_translate_same_language(monkeypatch) -> None:
    translator = HyMtTranslator()
    monkeypatch.setattr(
        translator,
        "_ensure_server",
        lambda: (_ for _ in ()).throw(AssertionError("server must stay stopped")),
    )
    assert (
        translator.translate("这是中文", Language.CHINESE_SIMPLIFIED, Language.CHINESE_SIMPLIFIED)
        == "这是中文"
    )


def test_find_llama_server_honors_environment(monkeypatch, tmp_path) -> None:
    executable = tmp_path / "llama-server.exe"
    executable.write_bytes(b"exe")
    monkeypatch.setenv("LLAMA_SERVER_PATH", str(executable))
    assert hymt_module.find_llama_server() == Path(executable).resolve()


def test_speech_style_detection_covers_supported_language_families() -> None:
    assert detect_speech_style("감사합니다. 확인해 주세요.", Language.KOREAN) == "polite"
    assert detect_speech_style("고마워. 나중에 봐.", Language.KOREAN) == "casual"
    assert detect_speech_style("ありがとうございます。", Language.JAPANESE) == "polite"
    assert detect_speech_style("ありがとう。またね。", Language.JAPANESE) == "casual"
    assert detect_speech_style("Could you please check this?", Language.ENGLISH) == "polite"
    assert detect_speech_style("Hey, check this out!", Language.ENGLISH) == "casual"
    assert detect_speech_style("请您确认一下，谢谢。", Language.CHINESE_SIMPLIFIED) == "polite"
    assert detect_speech_style("你看看，谢了。", Language.CHINESE_SIMPLIFIED) == "casual"


def test_style_rewrite_uses_target_specific_register_instruction() -> None:
    japanese_casual = _rewrite_style_prompt(
        "고마워요.", Language.KOREAN, "casual"
    )
    chinese_polite = _rewrite_style_prompt(
        "Could you check this?", Language.ENGLISH, "polite"
    )
    assert "Korean casual banmal" in japanese_casual
    assert "polite/formal English" in chinese_polite


def test_forced_style_overrides_detected_source_register() -> None:
    prompt = _rewrite_style_prompt(
        "今日来てくれてありがとう。",
        Language.JAPANESE,
        "polite",
    )
    assert "polite Japanese" in prompt
    assert "です/ます" in prompt


def test_style_has_its_own_translation_cache_namespace() -> None:
    assert HyMtTranslator(speech_style="polite").cache_namespace != HyMtTranslator(
        speech_style="casual"
    ).cache_namespace


def test_mismatched_translated_register_is_rewritten_once(monkeypatch, tmp_path) -> None:
    model = tmp_path / "model.gguf"
    model.write_bytes(b"test")
    server = tmp_path / "llama-server.exe"
    server.write_bytes(b"test")
    translator = HyMtTranslator(
        model_path=model,
        server_path=server,
        speech_style="auto",
    )
    translator._port = 32123
    monkeypatch.setattr(translator, "_ensure_server", lambda: None)
    prompts: list[str] = []
    responses = iter(["고마워요. 도움이 되었어요.", "고마워. 도움이 됐어."])

    def fake_post(url, *, json, timeout):
        del url, timeout
        prompts.append(json["messages"][0]["content"])
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"choices": [{"message": {"content": next(responses)}}]},
        )

    monkeypatch.setattr(hymt_module.httpx, "post", fake_post)
    result = translator.translate(
        "ありがとう。助かったよ。",
        Language.JAPANESE,
        Language.KOREAN,
    )

    assert result == "고마워. 도움이 됐어."
    assert len(prompts) == 2
    assert "Rewrite the following Korean text" in prompts[1]
    assert "Korean casual banmal" in prompts[1]


def test_forced_style_always_runs_final_rewrite(monkeypatch, tmp_path) -> None:
    model = tmp_path / "model.gguf"
    model.write_bytes(b"test")
    translator = HyMtTranslator(model_path=model, speech_style="polite")
    translator._port = 32123
    monkeypatch.setattr(translator, "_ensure_server", lambda: None)
    prompts: list[str] = []
    responses = iter(["今日来てくれてありがとう。", "今日来てくださってありがとうございます。"])

    def fake_post(url, *, json, timeout):
        del url, timeout
        prompts.append(json["messages"][0]["content"])
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"choices": [{"message": {"content": next(responses)}}]},
        )

    monkeypatch.setattr(hymt_module.httpx, "post", fake_post)
    result = translator.translate("와줘서 고마워.", Language.KOREAN, Language.JAPANESE)

    assert result == "今日来てくださってありがとうございます。"
    assert len(prompts) == 2
    assert "Rewrite the following Japanese text" in prompts[1]


def test_style_rewrite_that_drops_content_is_rejected(monkeypatch, tmp_path) -> None:
    model = tmp_path / "model.gguf"
    model.write_bytes(b"test")
    translator = HyMtTranslator(model_path=model, speech_style="auto")
    translator._port = 32123
    monkeypatch.setattr(translator, "_ensure_server", lambda: None)
    responses = iter(["보세요, 고마워.", "봐"])

    monkeypatch.setattr(
        hymt_module.httpx,
        "post",
        lambda *args, **kwargs: SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"choices": [{"message": {"content": next(responses)}}]},
        ),
    )
    result = translator.translate(
        "你看看，谢了。",
        Language.CHINESE_SIMPLIFIED,
        Language.KOREAN,
    )

    assert result == "봐, 고마워."
