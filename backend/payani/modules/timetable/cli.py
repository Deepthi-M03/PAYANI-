"""Import a timetable dataset from files on disk (recommended for the national datasets).

DataMeet (CC0; data dated 8 August 2016):
    python -m payani.modules.timetable.cli import --source datameet-railways --path data/datameet --confirm-licence

data.gov.in CSV (enter the licence and date from the resource page you downloaded from):
    python -m payani.modules.timetable.cli import --source data-gov-in-timetable --path data/timetable.csv ^
        --published-on 2015-08-03 --licence "Government Open Data License - India" --confirm-licence

Other commands:
    python -m payani.modules.timetable.cli validate --source datameet-railways --path data/datameet
    python -m payani.modules.timetable.cli status
    python -m payani.modules.timetable.cli withdraw

`validate` parses and checks the files without touching the database.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from payani.domain import timetable_import as ti


def _read(path: Path) -> dict[str, bytes]:
    if path.is_dir():
        files = {p.name: p.read_bytes() for p in sorted(path.iterdir()) if p.suffix.lower() in (".json", ".csv")}
        if not files:
            raise SystemExit(f"No .json or .csv files in {path}.")
        return files
    data = path.read_bytes()
    return ti.read_zip(data) if path.suffix.lower() == ".zip" else {path.name: data}


def _summary(counts: dict, report: dict) -> str:
    lines = [f"  {k}: {v}" for k, v in counts.items()]
    for item in report.get("by_code", [])[:12]:
        lines.append(f"  {item['severity']:7} {item['code']}: {item['count']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="payani.modules.timetable.cli", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("import", "validate"):
        p = sub.add_parser(name)
        p.add_argument("--source", required=True, choices=sorted(ti.SOURCES))
        p.add_argument("--path", required=True, type=Path, help="Folder, .zip, or .csv file")
        p.add_argument("--published-on", type=date.fromisoformat)
        p.add_argument("--licence")
        p.add_argument("--retrieved-on", type=date.fromisoformat)
        p.add_argument("--confirm-licence", action="store_true", help="I checked the dataset's licence")
    sub.add_parser("status")
    sub.add_parser("withdraw")
    args = ap.parse_args(argv)

    if args.cmd == "validate":
        parsed = ti.parse(args.source, _read(args.path))
        ok, reason = ti.accepted(parsed)
        print("ACCEPTED" if ok else f"REJECTED: {reason}")
        print(_summary(parsed.counts(), parsed.report.to_dict()))
        return 0 if ok else 1

    from payani.core.db import get_sessionmaker
    from payani.modules.admin import audit
    from payani.modules.book import catalog
    from payani.modules.timetable import service

    db = get_sessionmaker()()
    try:
        if args.cmd == "status":
            print(json.dumps(catalog.freshness(db), indent=2, default=str))
            return 0
        if args.cmd == "withdraw":
            rec = service.withdraw_active(db)
            if rec is None:
                print("No imported timetable is active.")
                return 1
            audit.record(db, request=None, actor_id=None, action="timetable.withdraw", entity_type="timetable_import",
                         entity_id=str(rec.id), after={"status": rec.status, "via": "cli"})
            db.commit()
            print("Withdrawn. Journey search uses the simulated catalogue again.")
            return 0
        req = service.ImportRequest(source_key=args.source, files=_read(args.path), file_name=args.path.name,
                                    published_on=args.published_on, licence=args.licence,
                                    licence_confirmed=args.confirm_licence, retrieved_on=args.retrieved_on)
        rec = service.run_import(db, req)
        audit.record(db, request=None, actor_id=None, action="timetable.import", entity_type="timetable_import",
                     entity_id=str(rec.id), after={"status": rec.status, "source": rec.source_key,
                                                   "counts": rec.counts, "error": rec.error, "via": "cli"})
        db.commit()
        print(f"Import {rec.id}: {rec.status.upper()}" + (f" ({rec.error})" if rec.error else ""))
        print(_summary(rec.counts or {}, rec.report or {}))
        return 0 if rec.status in ("active", "unchanged") else 1
    except Exception as exc:  # AppError and friends: print a readable line, not a traceback
        title = getattr(exc, "title", None) or str(exc)
        detail = getattr(exc, "detail", None)
        print(f"Error: {title}" + (f" {detail}" if detail else ""), file=sys.stderr)
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
