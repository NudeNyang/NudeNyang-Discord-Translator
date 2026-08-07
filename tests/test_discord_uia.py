from discord_translate_overlay.accessibility.discord_uia import (
    BUTTON_CONTROL,
    HYPERLINK_CONTROL,
    IMAGE_CONTROL,
    LIST_ITEM_CONTROL,
    TEXT_CONTROL,
    UiaElement,
    build_snapshot,
)
from discord_translate_overlay.models import Language, Rect


def _element(
    name: str,
    bbox: Rect,
    control_type: int,
    class_name: str = "",
    automation_id: str = "",
    font_name: str = "",
    font_size: float = 0.0,
) -> UiaElement:
    return UiaElement(
        name, bbox, control_type, class_name, automation_id, font_name, font_size
    )


def test_builds_exact_messages_embeds_and_channels_without_header_leakage() -> None:
    elements = [
        _element("Discord", Rect(0, 0, 1000, 800), 50030, automation_id="RootWebArea"),
        _element(
            "server: 📢│お知らせ",
            Rect(320, 42, 460, 66),
            TEXT_CONTROL,
            "title__9293f",
        ),
        _element(
            "읽지 않은 📢│お知らせ (채팅 채널)",
            Rect(80, 120, 310, 154),
            HYPERLINK_CONTROL,
            "link__2ea32",
        ),
        _element(
            "alice2026-08-05 오후 1:00@everyone 明日は集会です",
            Rect(320, 100, 900, 300),
            LIST_ITEM_CONTROL,
            "messageListItem__5126c",
            "chat-messages-1-100",
        ),
        _element("alice", Rect(380, 110, 440, 132), 50026, "header_c19a55"),
        _element("alice", Rect(380, 110, 420, 130), BUTTON_CONTROL, "username_c19a55"),
        _element("@everyone", Rect(380, 136, 465, 158), BUTTON_CONTROL, "roleMention__75297"),
        _element(
            "party-monkey",
            Rect(500, 158, 524, 182),
            IMAGE_CONTROL,
            "emoji",
        ),
        _element(
            "\n明日は集会です",
            Rect(380, 136, 560, 180),
            TEXT_CONTROL,
            font_name="gg sans",
            font_size=12.0,
        ),
        _element("https://example.com", Rect(380, 182, 550, 204), HYPERLINK_CONTROL),
        _element("", Rect(380, 210, 760, 280), 50026, "embedFull__623de"),
        _element(
            "天使の衣装です",
            Rect(396, 222, 570, 244),
            TEXT_CONTROL,
            font_name="gg sans",
            font_size=10.5,
        ),
        _element(
            "bobHello",
            Rect(320, 310, 900, 380),
            LIST_ITEM_CONTROL,
            "messageListItem__5126c",
            "chat-messages-1-101",
        ),
        _element("Hello there", Rect(380, 338, 520, 360), TEXT_CONTROL),
    ]

    snapshot = build_snapshot(
        elements,
        Rect(320, 80, 900, 760),
        Rect(72, 80, 320, 760),
        Rect(320, 32, 740, 80),
    )

    assert snapshot.available
    assert snapshot.visible_message_rows == 2
    assert [message.source_text for message in snapshot.messages] == [
        "明日は集会です",
        "天使の衣装です",
        "Hello there",
    ]
    assert all("server:" not in message.source_text for message in snapshot.messages)
    assert snapshot.messages[0].bbox.top == 77
    assert snapshot.messages[0].source_language is Language.JAPANESE
    assert snapshot.messages[0].render_font_size == 12.0
    assert snapshot.messages[0].render_font_family == "gg sans"
    assert snapshot.messages[0].render_kind == "body"
    assert snapshot.messages[0].render_container is not None
    assert snapshot.messages[0].render_container.right > snapshot.messages[0].bbox.right
    assert any(
        candidate.engine == "layout-inline-media:emoji"
        for candidate in snapshot.messages[0].lines[0].candidates
    )
    assert snapshot.messages[1].render_font_size == 10.5
    assert snapshot.messages[1].render_kind == "embed"
    assert snapshot.messages[0].lines[0].candidates
    assert snapshot.sidebar_messages[0].source_text == "お知らせ"
    assert snapshot.header_messages[0].source_text == "お知らせ"


def test_returns_unavailable_when_chromium_document_is_not_exposed() -> None:
    snapshot = build_snapshot(
        [],
        Rect(300, 80, 900, 700),
        Rect(70, 80, 300, 700),
        Rect(300, 32, 700, 80),
    )

    assert not snapshot.available
    assert snapshot.messages == ()


def test_skips_text_group_that_is_mostly_clipped_above_chat_viewport() -> None:
    elements = [
        _element("Discord", Rect(0, 0, 1000, 800), 50030, automation_id="RootWebArea"),
        _element(
            "alice clipped message",
            Rect(320, 40, 900, 180),
            LIST_ITEM_CONTROL,
            "messageListItem__5126c",
            "chat-messages-1-200",
        ),
        _element(
            "一行目\n二行目\n三行目",
            Rect(380, 45, 600, 125),
            TEXT_CONTROL,
            font_name="gg sans",
            font_size=12.0,
        ),
    ]

    snapshot = build_snapshot(
        elements,
        Rect(320, 100, 900, 760),
        Rect(72, 80, 320, 760),
        Rect(320, 32, 740, 80),
    )

    assert snapshot.visible_message_rows == 1
    assert snapshot.messages == ()
