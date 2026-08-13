#!/usr/bin/env python3
"""Export the app's measured MoonBoard hold centres for the web preview."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


LAYOUTS = {
    1: "moonboard_2010.json",
    2: "moonboard_2016.json",
    3: "moonboard_2024.json",
    4: "moonboard_2017.json",
    5: "moonboard_2019.json",
    6: "mini_moonboard_2020.json",
    7: "mini_moonboard_2025.json",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-repo", type=Path, required=True)
    parser.add_argument(
        "--output", type=Path,
        default=Path("competitions/data/moonboard-preview-geometry.json"),
    )
    args = parser.parse_args()
    source = args.app_repo / "androidApp/src/main/assets/board_images"
    layouts = {}
    for layout_id, filename in LAYOUTS.items():
        data = json.loads((source / filename).read_text(encoding="utf-8"))
        holds = {
            str(int(hold["holdId"])): [round(float(hold["x"]), 7), round(float(hold["y"]), 7)]
            for hold in data["holds"]
            if 0 <= float(hold["x"]) <= 1 and 0 <= float(hold["y"]) <= 1
        }
        if len(holds) not in (132, 198):
            raise ValueError(f"{filename}: unexpected hold count {len(holds)}")
        layouts[str(layout_id)] = {"aspect": float(data["imageAspect"]), "holds": holds}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"v": 1, "layouts": layouts}, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {args.output} ({sum(len(v['holds']) for v in layouts.values())} holds)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
