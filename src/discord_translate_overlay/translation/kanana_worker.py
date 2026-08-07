from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..models import Language
from .kanana import KananaInferenceEngine


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), required=True)
    parser.add_argument("--precision", choices=("int4", "native"), required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")

    engine = KananaInferenceEngine(
        device=args.device,
        precision=args.precision,
        cache_dir=args.cache_dir,
    )
    try:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                if request.get("command") == "close":
                    break
                items = [
                    (str(item["text"]), Language(str(item["source"])))
                    for item in request["items"]
                ]
                target = Language(str(request["target"]))
                results = engine.translate_many(items, target)
                response = {
                    "results": results,
                    "device": engine.selected_device,
                    "metrics": engine.runtime_metrics(),
                }
            except Exception as exc:
                response = {"error": str(exc)}
            print(json.dumps(response, ensure_ascii=False), flush=True)
    finally:
        engine.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
