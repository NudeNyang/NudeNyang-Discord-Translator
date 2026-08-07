import numpy as np

from discord_translate_overlay.models import (
    Language,
    Message,
    RecognitionCandidate,
    Rect,
    TextLine,
)
from discord_translate_overlay.rendering import attach_message_surfaces


def test_message_uses_its_local_discord_surface_instead_of_global_theme() -> None:
    frame = np.full((100, 160, 3), (56, 51, 49), dtype=np.uint8)
    # Simulate a hovered Discord row with a different flat BGR background.
    frame[20:62, 18:148] = (68, 62, 58)
    # Bright glyphs must not pull the sampled surface toward white.
    frame[30:45, 30:105] = (230, 230, 230)
    message = Message(
        bbox=Rect(24, 26, 112, 50),
        source_text="テスト",
        source_language=Language.JAPANESE,
        render_container=Rect(24, 26, 145, 60),
    )

    attach_message_surfaces(frame, [message])

    assert message.render_background_rgb == (58, 62, 68)


def test_surface_sampling_is_clipped_safely_at_viewport_edge() -> None:
    frame = np.full((30, 40, 3), (40, 35, 30), dtype=np.uint8)
    message = Message(
        bbox=Rect(35, 24, 44, 34),
        source_text="端",
        source_language=Language.JAPANESE,
    )

    attach_message_surfaces(frame, [message])

    assert message.render_background_rgb == (30, 35, 40)


def test_uia_emoji_pixels_are_captured_for_message_level_composition() -> None:
    frame = np.full((50, 70, 3), (49, 51, 56), dtype=np.uint8)
    frame[12:20, 24:32] = (10, 40, 240)
    bbox = Rect(10, 10, 60, 32)
    line = TextLine(
        polygon=np.zeros((4, 2)),
        bbox=bbox,
        text="絵文字つき",
        confidence=1.0,
        language=Language.JAPANESE,
        candidates=(
            RecognitionCandidate(
                "layout-inline-media:emoji",
                "24,12,32,20|party-monkey",
                1.0,
            ),
        ),
    )
    message = Message(
        bbox=bbox,
        source_text=line.text,
        source_language=Language.JAPANESE,
        lines=[line],
    )

    attach_message_surfaces(frame, [message])

    assert len(message.render_inline_media) == 1
    media = message.render_inline_media[0]
    assert media.alt_text == "party-monkey"
    assert (media.width, media.height) == (8, 8)
    assert media.bgr[:3] == bytes((10, 40, 240))


def test_untagged_ocr_gap_is_not_treated_as_a_real_emoji_snapshot() -> None:
    frame = np.full((40, 60, 3), (49, 51, 56), dtype=np.uint8)
    bbox = Rect(10, 10, 50, 30)
    line = TextLine(
        polygon=np.zeros((4, 2)),
        bbox=bbox,
        text="前 後",
        confidence=1.0,
        language=Language.JAPANESE,
        candidates=(
            RecognitionCandidate("layout-inline-media", "20,10,30,30", 1.0),
        ),
    )
    message = Message(
        bbox=bbox,
        source_text=line.text,
        source_language=Language.JAPANESE,
        lines=[line],
    )

    attach_message_surfaces(frame, [message])

    assert message.render_inline_media == ()
