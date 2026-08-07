import numpy as np

from discord_translate_overlay.models import Language, Rect, TextLine
from discord_translate_overlay.ocr.message_grouper import group_message_lines


def _line(
    text: str,
    left: int,
    top: int,
    right: int,
    bottom: int,
    language: Language = Language.KOREAN,
) -> TextLine:
    return TextLine(
        polygon=np.array([[left, top], [right, top], [right, bottom], [left, bottom]]),
        bbox=Rect(left, top, right, bottom),
        text=text,
        confidence=0.95,
        language=language,
    )


def test_skips_username_on_same_row_as_timestamp() -> None:
    lines = [
        _line("Nude", 60, 10, 110, 28),
        _line("오늘 오후 1:39", 120, 12, 220, 27),
        _line("안녕하세요", 60, 32, 170, 52),
    ]
    messages = group_message_lines(lines, 300)
    assert [message.source_text for message in messages] == ["안녕하세요"]


def test_skips_korean_ui_timestamp_when_ocr_reads_colon_as_semicolon() -> None:
    lines = [
        _line("LemonKaju 2026-07-24 오전 6;40", 60, 10, 300, 28),
        _line("今夜です！", 60, 32, 170, 52, Language.JAPANESE),
        _line(
            "撮影画角を予めチェックしてください",
            60,
            56,
            350,
            77,
            Language.JAPANESE,
        ),
    ]

    messages = group_message_lines(lines, 600)

    assert len(messages) == 1
    assert messages[0].source_language is Language.JAPANESE
    assert messages[0].source_text == "今夜です！\n撮影画角を予めチェックしてください"


def test_skips_text_drawn_inside_attachment_surface() -> None:
    image = np.full((120, 300, 3), (30, 26, 26), dtype=np.uint8)
    image[50:110, 40:260] = (55, 50, 50)
    lines = [
        _line("일반 메시지", 50, 15, 160, 35),
        _line("첨부 이미지 안 글자", 60, 65, 220, 85),
    ]
    messages = group_message_lines(lines, 300, image)
    assert [message.source_text for message in messages] == ["일반 메시지"]


def test_skips_colored_username_but_keeps_neutral_body() -> None:
    image = np.full((100, 300, 3), (30, 26, 26), dtype=np.uint8)
    image[10:28, 50:130] = (220, 180, 20)
    image[15:23, 55:125] = (30, 26, 26)
    lines = [
        _line("HydraB", 50, 10, 130, 28),
        _line("Hello", 50, 34, 130, 54),
    ]
    messages = group_message_lines(lines, 300, image)
    assert [message.source_text for message in messages] == ["Hello"]


def test_keeps_body_on_discord_highlight_surface() -> None:
    image = np.full((100, 400, 3), (46, 42, 42), dtype=np.uint8)
    image[30:70, 20:380] = (30, 26, 26)
    lines = [
        _line("イベント録画完了後にプロキシを作成してください", 40, 36, 350, 58, Language.JAPANESE)
    ]

    messages = group_message_lines(lines, 400, image)

    assert [message.source_text for message in messages] == [
        "イベント録画完了後にプロキシを作成してください"
    ]


def test_merges_inline_ocr_fragments_into_the_same_visual_row() -> None:
    lines = [
        _line("起動オプションから", 40, 30, 176, 50, Language.JAPANESE),
        _line("--disable-hw-video-decoding", 184, 28, 385, 51, Language.ENGLISH),
        _line("を削除してください", 394, 30, 530, 50, Language.JAPANESE),
        _line("次の行も同じメッセージです", 40, 56, 250, 77, Language.JAPANESE),
    ]

    messages = group_message_lines(lines, 600)

    assert len(messages) == 1
    assert messages[0].source_text == (
        "起動オプションから --disable-hw-video-decoding を削除してください\n"
        "次の行も同じメッセージです"
    )
    assert messages[0].bbox.left == 37
    assert messages[0].bbox.right == 533


def test_marks_a_large_inline_gap_as_probable_custom_emoji() -> None:
    lines = [
        _line("ありがとう", 40, 30, 120, 50, Language.JAPANESE),
        _line("ございます", 154, 30, 240, 50, Language.JAPANESE),
    ]

    messages = group_message_lines(lines, 400)

    assert len(messages) == 1
    assert any(
        candidate.engine == "layout-inline-media"
        for candidate in messages[0].lines[0].candidates
    )


def test_keeps_body_date_but_skips_centered_date_separator() -> None:
    lines = [
        _line("2026년 7월 20일", 225, 10, 375, 30),
        _line("2026/09/06以降は準備を進めてください", 40, 45, 330, 66, Language.JAPANESE),
    ]

    messages = group_message_lines(lines, 600)

    assert [message.source_text for message in messages] == [
        "2026/09/06以降は準備を進めてください"
    ]


def test_url_row_does_not_hide_the_body_row_below_it() -> None:
    lines = [
        _line("https://example.com/docs", 40, 20, 260, 40, Language.ENGLISH),
        _line("更新で問題が解決しました", 40, 47, 250, 68, Language.JAPANESE),
    ]

    messages = group_message_lines(lines, 600)

    assert [message.source_text for message in messages] == ["更新で問題が解決しました"]


def test_translates_text_prefix_but_preserves_url_suffix() -> None:
    lines = [
        _line(
            "参加先https://vrc.group/4KVRC.9334",
            40,
            20,
            360,
            40,
            Language.JAPANESE,
        )
    ]

    messages = group_message_lines(lines, 600)

    assert len(messages) == 1
    assert messages[0].source_text == "参加先"
    assert messages[0].bbox.right < 140


def test_translates_reply_body_but_preserves_leading_mention() -> None:
    lines = [
        _line(
            "@LemonKaju第4回の授業を2026/07/24(金)22:00~23:00に始めます！",
            40,
            20,
            360,
            40,
            Language.JAPANESE,
        )
    ]

    messages = group_message_lines(lines, 600)

    assert len(messages) == 1
    assert messages[0].source_text == (
        "第4回の授業を2026/07/24(金)22:00~23:00に始めます！"
    )
    assert messages[0].bbox.left > 70


def test_anchors_isolated_inline_fragment_to_the_message_content_column() -> None:
    lines = [
        _line("通常の本文", 40, 20, 150, 41, Language.JAPANESE),
        _line("メンションの後ろにある本文", 300, 90, 540, 111, Language.JAPANESE),
    ]

    messages = group_message_lines(lines, 600)

    assert len(messages) == 2
    assert [message.bbox.left for message in messages] == [37, 37]
