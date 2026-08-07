from discord_translate_overlay.app import _parse_hex_color, _rect_distance
from discord_translate_overlay.models import Rect


def test_rect_distance_tracks_panel_layout_changes() -> None:
    assert _rect_distance(Rect(10, 20, 300, 400), Rect(10, 20, 300, 400)) == 0
    assert _rect_distance(Rect(10, 20, 300, 400), Rect(14, 20, 320, 400)) == 20


def test_parse_optional_overlay_color() -> None:
    assert _parse_hex_color("#313338") == (49, 51, 56)
    assert _parse_hex_color("") is None
    assert _parse_hex_color("not-a-color") is None
