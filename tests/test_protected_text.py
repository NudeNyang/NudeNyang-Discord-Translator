from discord_translate_overlay.translation.protected_text import protect_text


def test_masks_and_restores_mentions_emoji_and_emoticons() -> None:
    source = "Hello @everyone 👋🏽 :party_blob: ^_^ T_T"

    protected = protect_text(source)

    assert "@everyone" not in protected.masked
    assert "👋🏽" not in protected.masked
    assert ":party_blob:" not in protected.masked
    assert "^_^" not in protected.masked
    assert "T_T" not in protected.masked
    assert protected.has_translatable_text
    assert protected.restore(f"[ko] {protected.masked}") == f"[ko] {source}"


def test_emoji_and_kaomoji_only_text_needs_no_translation() -> None:
    protected = protect_text("👋 (╯°□°)╯ ^_^")

    assert not protected.has_translatable_text
    assert protected.restore(protected.masked) == "👋 (╯°□°)╯ ^_^"


def test_missing_marker_is_readded_instead_of_losing_tag() -> None:
    protected = protect_text("Hello @here")

    assert protected.restore("안녕하세요") == "안녕하세요 @here"


def test_normal_japanese_text_is_not_mistaken_for_emoji() -> None:
    source = "イベント録画をお願いします"

    protected = protect_text(source)

    assert protected.tokens == ()
    assert protected.masked == source


def test_emoticon_dominated_ocr_fragment_needs_no_translation() -> None:
    protected = protect_text("(•ω•)つス.....")

    assert "(•ω•)" in protected.tokens
    assert not protected.has_translatable_text
    assert protected.restore(protected.masked) == "(•ω•)つス....."


def test_short_real_text_next_to_unicode_emoji_is_still_translatable() -> None:
    protected = protect_text("雑談😊")

    assert protected.has_translatable_text


def test_preserves_common_japanese_chat_emoticons_exactly() -> None:
    samples = (
        "ありがとう神様m(__)m",
        "教えてください・\nω·')",
        "本日です！・ν・",
        "把握してないです>く;",
    )

    for source in samples:
        protected = protect_text(source)
        assert protected.tokens, source
        assert protected.restore(protected.masked) == source
