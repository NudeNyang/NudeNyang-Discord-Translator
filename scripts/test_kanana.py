from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from discord_translate_overlay.models import Language  # noqa: E402
from discord_translate_overlay.translation.kanana import KananaTranslator  # noqa: E402


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Kanana-2 1.3B 로컬 번역 스모크 테스트")
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--precision", choices=("int4", "native"), default="int4")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    translator = KananaTranslator(device=args.device, precision=args.precision)
    samples = [
        ("This sandwich is cheaper than in Korea.", Language.ENGLISH),
        ("3歳だから仕方ないね。言葉は難しいもんね。", Language.JAPANESE),
    ]
    started = time.perf_counter()
    results = translator.translate_many(samples, Language.KOREAN)
    first_elapsed = time.perf_counter() - started
    warm_started = time.perf_counter()
    warm_result = translator.translate("See you tomorrow!", Language.ENGLISH, Language.KOREAN)
    warm_elapsed = time.perf_counter() - warm_started

    payload = {
        "model": "kakaocorp/kanana-2-1.3b-instruct",
        "device": translator.selected_device,
        "precision": args.precision,
        "elapsed_seconds_including_load": round(first_elapsed, 3),
        "warm_single_message_seconds": round(warm_elapsed, 3),
        "warm_single_message_result": warm_result,
        **translator.runtime_metrics,
        "translations": [
            {"source": source, "target": translated}
            for (source, _), translated in zip(samples, results, strict=True)
        ],
    }
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    translator.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
