#!/usr/bin/env python3
"""Build browser-sized climb indexes from the exact snapshots used by the app.

Offline for Kilter/MoonBoard. Aurora-family snapshots require --download and
are fetched from the public, signed manifest archive; every blob is SHA-256
verified before decompression. No credential or production write is used.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import shutil
import sqlite3
import tempfile
import urllib.request
from pathlib import Path


BOARDS = {
    "kilter": ("cruxcoach_board-db.json", "scripts/data/kilter_board.bin", "gzip", (1, 8)),
    "moonboard": ("cruxcoach_moonboard-db.json", "scripts/data/moonboard_board.bin", "gzip", tuple(range(1, 8))),
    "tension": ("cruxcoach_tension-db.json", None, "zstd", (9, 10, 11)),
    "grasshopper": ("cruxcoach_grasshopper-db.json", None, "zstd", (1,)),
    "decoy": ("cruxcoach_decoy-db.json", None, "zstd", (2,)),
    "soill": ("cruxcoach_soill-db.json", None, "zstd", (1,)),
    "touchstone": ("cruxcoach_touchstone-db.json", None, "zstd", (1,)),
}


def clean_text(value: object, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def created_epoch(value: object) -> int | None:
    """Normalize the catalogue's SQL/ISO creation timestamps to UTC seconds."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        epoch = int(parsed.timestamp())
        return epoch if epoch > 0 else None
    except (ValueError, OverflowError):
        return None


def manifest(sync_repo: Path, filename: str) -> tuple[dict, dict]:
    event = json.loads((sync_repo / "manifest_archive" / filename).read_text(encoding="utf-8"))
    content = json.loads(event["content"])
    return event, content


def download_chunk(content: dict, target: Path) -> tuple[str, str]:
    chunks = content.get("chunks") or []
    if len(chunks) != 1:
        raise ValueError("web index download expects one full-snapshot chunk")
    chunk = chunks[0]
    expected = chunk["sha256"]
    error = None
    for url in reversed(chunk.get("urls") or []):
        try:
            with urllib.request.urlopen(url, timeout=60) as response, target.open("wb") as output:
                shutil.copyfileobj(response, output)
            actual = hashlib.sha256(target.read_bytes()).hexdigest()
            if actual != expected:
                raise ValueError(f"digest mismatch: {actual} != {expected}")
            return expected, url
        except Exception as exc:  # mirror failover is part of the app contract
            error = exc
    raise RuntimeError(f"all Blossom mirrors failed: {error}")


def unpack(source: Path, compression: str, target: Path) -> None:
    if compression == "gzip":
        with gzip.open(source, "rb") as incoming, target.open("wb") as output:
            shutil.copyfileobj(incoming, output)
        return
    if compression == "zstd":
        try:
            import zstandard  # type: ignore
        except ImportError as exc:
            raise RuntimeError("install the zstandard Python package for Aurora indexes") from exc
        with source.open("rb") as incoming, target.open("wb") as output:
            zstandard.ZstdDecompressor().copy_stream(incoming, output)
        return
    raise ValueError(f"unsupported compression: {compression}")


def layout_sizes(db: sqlite3.Connection, layout: int) -> list[tuple[int, int, int, int, int]]:
    # MoonBoard snapshots intentionally contain no Aurora product-size tables:
    # each layout is one physical board size.  An empty list therefore means
    # "layout already identifies the size", not a broken snapshot.
    has_product_sizes = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'product_sizes'"
    ).fetchone()
    if not has_product_sizes:
        return []
    return [tuple(map(int, row)) for row in db.execute(
        """SELECT DISTINCT ps.id, ps.edge_left, ps.edge_right, ps.edge_bottom, ps.edge_top
           FROM product_sizes ps
           JOIN product_sizes_layouts_sets pls ON pls.product_size_id = ps.id
           WHERE pls.layout_id = ? AND ps.is_listed = 1
           ORDER BY ps.id""",
        (layout,),
    )]


def size_bounds(brand: str, layout: int, sizes: list[tuple[int, int, int, int, int]]) -> dict[str, list[int]]:
    if brand == "moonboard":
        return {"default": [0, 10, 0, 11 if layout in (6, 7) else 17]}
    return {str(size_id): [left, right, bottom, top]
            for size_id, left, right, bottom, top in sizes}


def compatible_sizes(edges: tuple[object, object, object, object], sizes: list[tuple[int, int, int, int, int]]) -> list[int]:
    if not sizes:
        return []
    if any(value is None for value in edges):
        return []
    left, right, bottom, top = map(int, edges)
    return [size_id for size_id, size_left, size_right, size_bottom, size_top in sizes
            if left >= size_left and right <= size_right and bottom >= size_bottom and top <= size_top]


def climb_holds(db: sqlite3.Connection, brand: str, layout: int) -> dict[int, tuple[int, int]]:
    """Placement coordinates used by the read-only web preview.

    Coordinates come from the same catalogue row as the climb.  The browser
    never guesses where a placement lives, and a zone can therefore only name
    a real hold from that climb.
    """
    if brand == "moonboard":
        rows = 12 if layout in (6, 7) else 18
        return {pid: ((pid - 1) % 11, (pid - 1) // 11) for pid in range(1, 11 * rows + 1)}
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"placements", "holes"}.issubset(tables):
        return {}
    return {int(pid): (int(x), int(y)) for pid, x, y in db.execute(
        """SELECT p.id, h.x, h.y FROM placements p JOIN holes h ON h.id = p.hole_id
           WHERE p.layout_id = ?""", (layout,))}


def parse_holds(frames: object, coordinates: dict[int, tuple[int, int]]) -> list[list[int]]:
    import re
    result = []
    for placement, role in re.findall(r"p(\d+)r(\d+)", str(frames or "").split(",", 1)[0]):
        pid = int(placement)
        xy = coordinates.get(pid)
        if xy is not None:
            result.append([pid, int(role), xy[0], xy[1]])
    return result[:200]


def export_layout(db: sqlite3.Connection, brand: str, layout: int, header: dict, target: Path) -> int:
    sizes = layout_sizes(db, layout)
    coordinates = climb_holds(db, brand, layout)
    query = db.execute(
        """SELECT c.uuid, c.name, COALESCE(c.setter_username, ''),
                  c.edge_left, c.edge_right, c.edge_bottom, c.edge_top,
                  c.frames, c.created_at,
                  s.angle, s.display_difficulty, s.quality_average,
                  COALESCE(s.ascensionist_count, 0)
           FROM climbs c
           JOIN climb_stats s ON s.climb_uuid = c.uuid
           WHERE c.is_listed = 1 AND c.layout_id = ?
           ORDER BY lower(c.name), lower(c.uuid), s.angle""",
        (layout,),
    )
    records: list[list] = []
    current_uuid = None
    current = None
    for uuid, name, setter, left, right, bottom, top, frames, created_at, angle, difficulty, quality, ascents in query:
        normalized = str(uuid).lower()
        if normalized != current_uuid:
            current_uuid = normalized
            current = [
                normalized,
                clean_text(name, 200),
                clean_text(setter, 160),
                compatible_sizes((left, right, bottom, top), sizes),
                parse_holds(frames, coordinates),
                created_epoch(created_at),
                [],
            ]
            records.append(current)
        current[6].append([
            int(angle),
            round(float(difficulty), 2) if difficulty is not None else None,
            round(float(quality), 2) if quality is not None else None,
            max(0, int(ascents or 0)),
        ])

    complete_header = {**header, "v": 3, "brand": brand, "layout": layout, "rows": len(records),
                       "size_bounds": size_bounds(brand, layout, sizes)}
    with target.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", compresslevel=9, mtime=0, fileobj=raw) as zipped:
            zipped.write((json.dumps(complete_header, separators=(",", ":")) + "\n").encode())
            for record in records:
                zipped.write((json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    return len(records)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sync-repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("competitions/data/climbs"))
    parser.add_argument("--download", action="store_true", help="fetch public Aurora snapshot chunks")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    written = []

    with tempfile.TemporaryDirectory(prefix="cruxcoach-climb-index-") as scratch_name:
        scratch = Path(scratch_name)
        for brand, (manifest_name, local_name, compression, layouts) in BOARDS.items():
            event, content = manifest(args.sync_repo, manifest_name)
            source_hash = None
            source_url = None
            if local_name:
                packed = args.sync_repo / local_name
                if not packed.is_file():
                    raise FileNotFoundError(packed)
                actual = hashlib.sha256(packed.read_bytes()).hexdigest()
                source_hash = actual
            else:
                if not args.download:
                    print(f"skip {brand}: pass --download for its public Blossom chunk")
                    continue
                packed = scratch / f"{brand}.zst"
                source_hash, source_url = download_chunk(content, packed)
            sqlite_path = scratch / f"{brand}.sqlite"
            unpack(packed, compression, sqlite_path)
            db = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
            try:
                if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
                    raise ValueError(f"{brand} snapshot failed SQLite integrity check")
                for layout in layouts:
                    target = args.output / f"{brand}-{layout}.ndjson.gz"
                    count = export_layout(db, brand, layout, {
                        "snapshot_at": int(content.get("created_at") or event["created_at"]),
                        "source_manifest": event["id"],
                        "source_blob": source_hash,
                    }, target)
                    digest = hashlib.sha256(target.read_bytes()).hexdigest()
                    written.append({
                        "brand": brand, "layout": layout, "rows": count,
                        "file": target.name, "bytes": target.stat().st_size, "sha256": digest,
                        "source_manifest": event["id"], "source_url": source_url,
                    })
                    print(f"{target}: {count:,} climbs, {target.stat().st_size:,} bytes")
            finally:
                db.close()

    manifest_target = args.output / "manifest.json"
    manifest_target.write_text(json.dumps({"v": 1, "indexes": written}, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
