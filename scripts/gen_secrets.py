#!/usr/bin/env python3
"""Create .env from .env.example, replacing every CHANGE_ME with a random value.

Standard library only, so it runs before anything is installed. Existing values in
.env are kept; only missing or CHANGE_ME values are filled.
"""

import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / ".env.example"
TARGET = ROOT / ".env"


def parse(path: Path) -> dict[str, str]:
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if line and not line.lstrip().startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value
    return values


def main() -> int:
    existing = parse(TARGET)
    generated = {}
    out = []
    for line in EXAMPLE.read_text().splitlines():
        if line and not line.lstrip().startswith("#") and "=" in line:
            key, _, default = line.partition("=")
            key = key.strip()
            value = existing.get(key, default)
            if value == "CHANGE_ME" or not value:
                value = secrets.token_urlsafe(48 if key == "JWT_SECRET" else 18)
                generated[key] = value
            out.append(f"{key}={value}")
        else:
            out.append(line)
    TARGET.write_text("\n".join(out) + "\n")
    try:
        TARGET.chmod(0o600)
    except OSError:
        pass

    print(f"Wrote {TARGET.relative_to(ROOT)} ({len(generated)} value(s) generated).")
    seeds = {
        "SEED_PASSENGER_PASSWORD": "passenger@example.com",
        "SEED_ADMIN_PASSWORD": "admin@example.com",
        "SEED_SUPER_ADMIN_PASSWORD": "superadmin@example.com",
    }
    final = parse(TARGET)
    print("\nDemo accounts (development only):")
    for key, email in seeds.items():
        print(f"  {email:<26} {final.get(key, '?')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
