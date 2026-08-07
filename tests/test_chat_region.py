import numpy as np

from discord_translate_overlay.capture.chat_region import detect_chat_region


def test_detects_channel_chat_and_member_boundaries() -> None:
    image = np.zeros((1000, 1000, 3), dtype=np.uint8)
    image[:, :70] = (18, 18, 20)
    image[:, 70:290] = (22, 22, 25)
    image[:, 290:760] = (30, 30, 34)
    image[:, 760:] = (30, 30, 34)
    image[:, 759:760] = (45, 45, 50)
    region = detect_chat_region(image)
    assert abs(region.left - 290) <= 3
    assert abs(region.right - 759) <= 3
    assert region.top == 44
    assert region.bottom == 965


def test_uses_window_edge_when_member_list_is_absent() -> None:
    image = np.zeros((800, 900, 3), dtype=np.uint8)
    image[:, :260] = (20, 20, 22)
    image[:, 260:] = (32, 32, 36)
    region = detect_chat_region(image)
    assert abs(region.left - 260) <= 3
    assert region.right > 880


def test_detects_chat_boundary_before_sixteen_percent_on_wide_discord() -> None:
    image = np.zeros((1000, 2000, 3), dtype=np.uint8)
    image[:, :120] = (18, 18, 20)
    image[:, 120:220] = (22, 22, 25)
    image[:, 220:1700] = (30, 30, 34)
    image[:, 1699:1700] = (45, 45, 50)

    region = detect_chat_region(image)

    assert abs(region.left - 220) <= 3
    assert abs(region.right - 1699) <= 3


def test_does_not_mistake_message_text_alignment_for_panel_boundary() -> None:
    image = np.zeros((1000, 1000, 3), dtype=np.uint8)
    image[:, :70] = (18, 18, 20)
    image[:, 70:300] = (22, 22, 25)
    image[:, 300:760] = (30, 30, 34)
    image[:, 760:] = (25, 25, 29)
    # A long announcement block can create a very persistent vertical edge at
    # the message content indent. It is real, but weaker than the panel edge.
    image[100:850, 380:760] = (39, 39, 44)

    region = detect_chat_region(image)

    assert abs(region.left - 300) <= 3
