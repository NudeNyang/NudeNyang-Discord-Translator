import numpy as np

from discord_translate_overlay.models import Language, Message, OverlayStyle, Rect
from discord_translate_overlay.static_render import render_messages


def test_render_replaces_only_message_rectangle() -> None:
    image = np.full((120, 300, 3), 80, dtype=np.uint8)
    message = Message(
        bbox=Rect(20, 30, 250, 60),
        source_text="Hello",
        source_language=Language.ENGLISH,
        translated_text="안녕하세요",
    )
    output = render_messages(image, [message], OverlayStyle((49, 51, 56), (219, 222, 225)))
    assert np.array_equal(output[0, 0], image[0, 0])
    assert not np.array_equal(output[35, 25], image[35, 25])
