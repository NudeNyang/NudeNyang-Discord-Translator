from discord_translate_overlay.models import Rect
from discord_translate_overlay.ui.region_selector import _logical_to_physical_rect


def test_selection_coordinates_are_scaled_to_physical_pixels() -> None:
    assert _logical_to_physical_rect(Rect(100, 200, 500, 700), 1.75) == Rect(
        175, 350, 875, 1225
    )
