"""Split a travelling group into booking batches (one PNR each).

Objective, in strict priority order:
1. as few PNRs as possible: ceil(group size / per-PNR cap) is always achievable;
2. as few families (sub-groups) split across PNRs as possible;
3. every PNR that contains a minor also contains an adult from the minor's family
   (when the family has enough adults), otherwise a warning is returned.

The packing is exact (branch and bound over family sizes) for realistic groups and
falls back to a greedy split for very large ones. Nothing here promises adjacent seats:
seat allocation belongs to the railway, and the output says so.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Traveller:
    id: str
    name: str
    family: str  # sub-group label, e.g. "Sharma family"; singletons use their own id
    is_minor: bool = False


@dataclass
class Batch:
    travellers: list[Traveller] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.travellers)


@dataclass
class Plan:
    cap: int
    batches: list[Batch]
    families_split: list[str]
    warnings: list[str]
    explanation: list[str]


EXACT_LIMIT = 40  # travellers; above this the greedy fallback is used


def plan_batches(travellers: list[Traveller], cap: int) -> Plan:
    if cap < 1:
        raise ValueError("cap must be at least 1")
    if not travellers:
        return Plan(cap, [], [], [], ["No travellers to plan."])
    ids = [t.id for t in travellers]
    if len(set(ids)) != len(ids):
        raise ValueError("traveller ids must be unique")

    families: dict[str, list[Traveller]] = {}
    for t in travellers:
        families.setdefault(t.family, []).append(t)
    n_bins = math.ceil(len(travellers) / cap)

    sizes = sorted(((len(m), fam) for fam, m in families.items()), reverse=True)
    if len(travellers) <= EXACT_LIMIT:
        pieces = _pack_exact([s for s, _ in sizes], n_bins, cap)
    else:
        pieces = _pack_greedy([s for s, _ in sizes], n_bins, cap)

    batches = [Batch() for _ in range(n_bins)]
    split: list[str] = []
    warnings: list[str] = []
    for (_size, fam), alloc in zip(sizes, pieces, strict=True):
        members = _order_for_split(families[fam], [k for k in alloc if k > 0])
        chunks = [k for k in alloc if k > 0]
        if len(chunks) > 1:
            split.append(fam)
        pos = 0
        for b, k in enumerate(alloc):
            if k:
                part = members[pos:pos + k]
                pos += k
                batches[b].travellers.extend(part)
                if any(p.is_minor for p in part) and not any(not p.is_minor for p in part):
                    warnings.append(
                        f"A minor from {fam} is in a booking without an adult from their family. "
                        "Consider adding an adult or keeping them on the same booking."
                    )
    batches = [b for b in batches if b.size]

    explanation = [
        f"{len(travellers)} travellers with at most {cap} per booking need at least "
        f"{n_bins} booking{'s' if n_bins > 1 else ''}; this plan uses exactly that.",
        "No family is split across bookings." if not split else
        f"{len(split)} famil{'y is' if len(split) == 1 else 'ies are'} split because a "
        "booking cannot hold them whole: " + ", ".join(split) + ".",
        "Seats are allocated by the railway. Separate bookings may not be seated together, "
        "and PAYANI cannot guarantee adjacent seats.",
    ]
    return Plan(cap, batches, split, warnings, explanation)


def _order_for_split(members: list[Traveller], chunk_sizes: list[int]) -> list[Traveller]:
    """Order a family so that, when cut into consecutive chunks, each chunk gets an adult
    before any chunk gets a second adult."""
    adults = [m for m in members if not m.is_minor]
    minors = [m for m in members if m.is_minor]
    chunks: list[list[Traveller]] = [[] for _ in chunk_sizes]
    for i in range(len(chunk_sizes)):
        if adults:
            chunks[i].append(adults.pop(0))
    rest = minors + adults
    for i, size in enumerate(chunk_sizes):
        while len(chunks[i]) < size:
            chunks[i].append(rest.pop(0))
    return [m for c in chunks for m in c]


def _pack_exact(sizes: list[int], n_bins: int, cap: int) -> list[list[int]]:
    """Return, for each family (in `sizes` order), how many members go into each bin,
    minimising the number of families split across bins. Branch and bound."""
    best: dict = {"splits": math.inf, "alloc": None}
    loads = [0] * n_bins
    alloc: list[list[int]] = [[0] * n_bins for _ in sizes]
    lower_extra = [max(0, math.ceil(s / cap) - 1) for s in sizes]  # unavoidable splits
    remaining_lb = [sum(1 for x in lower_extra[i:] if x) for i in range(len(sizes) + 1)]

    def dfs(i: int, splits: int):
        if splits + remaining_lb[i] >= best["splits"]:
            return
        if i == len(sizes):
            best["splits"], best["alloc"] = splits, [row[:] for row in alloc]
            return
        s = sizes[i]
        tried: set[int] = set()
        for b in range(n_bins):  # whole family into one bin
            if cap - loads[b] >= s and loads[b] not in tried:
                tried.add(loads[b])
                loads[b] += s
                alloc[i][b] = s
                dfs(i + 1, splits)
                loads[b] -= s
                alloc[i][b] = 0
        # split across bins: fill the fullest bins first (keeps space contiguous)
        order = sorted(range(n_bins), key=lambda b: -loads[b])
        left, used = s, []
        for b in order:
            room = cap - loads[b]
            if room <= 0 or left == 0:
                continue
            k = min(room, left)
            used.append((b, k))
            left -= k
        if left == 0 and len(used) > 1:
            for b, k in used:
                loads[b] += k
                alloc[i][b] = k
            dfs(i + 1, splits + 1)
            for b, k in used:
                loads[b] -= k
                alloc[i][b] = 0

    dfs(0, 0)
    if best["alloc"] is None:  # pragma: no cover - splitting always fits n_bins * cap
        return _pack_greedy(sizes, n_bins, cap)
    return best["alloc"]


def _pack_greedy(sizes: list[int], n_bins: int, cap: int) -> list[list[int]]:
    loads = [0] * n_bins
    out = []
    for s in sizes:
        row = [0] * n_bins
        fit = next((b for b in range(n_bins) if cap - loads[b] >= s), None)
        if fit is not None:
            row[fit] = s
            loads[fit] += s
        else:
            left = s
            for b in sorted(range(n_bins), key=lambda b: -(cap - loads[b])):
                k = min(cap - loads[b], left)
                if k > 0:
                    row[b] = k
                    loads[b] += k
                    left -= k
        out.append(row)
    return out
