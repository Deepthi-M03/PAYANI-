from datetime import date

import pytest

from payani.domain import catalog_synth as cat
from payani.domain import routing as r

TRAINS = cat.generate_trains()
DATE = date(2026, 12, 18)  # a Friday


def test_catalogue_is_deterministic_and_clearly_synthetic():
    again = cat.generate_trains()
    assert [t.number for t in TRAINS] == [t.number for t in again]
    assert all(90000 <= int(t.number) <= 90999 for t in TRAINS)
    assert all(t.name.startswith("PAYANI Sim") for t in TRAINS)
    assert all(s.station in cat.STATION_BY_CODE for t in TRAINS for s in t.stops)


def test_stop_times_are_increasing():
    for t in TRAINS:
        times = []
        for s in t.stops:
            if s.arr is not None:
                times.append(s.arr)
            if s.dep is not None:
                times.append(s.dep)
        assert times == sorted(times), t.number


def test_station_search_prefers_exact_code_then_prefix():
    assert cat.station_search("mas")[0].code == "MAS"
    assert [s.code for s in cat.station_search("chen")] == ["MAS"]
    assert cat.station_search("") == []


def test_direct_journey_found_with_reasons_and_labels():
    results = r.search(TRAINS, "MAS", "SBC", DATE)
    assert results, "MAS-SBC is served by the Southern Arc corridor"
    direct = [j for j in results if j.transfers == 0]
    assert direct
    d = r.journey_to_dict(direct[0], DATE)
    assert d["data"]["confidence"] == "simulated"
    assert any(x["code"] == "direct" for x in d["reasons"])
    assert d["legs"][0]["from"] == "MAS" and d["legs"][-1]["to"] == "SBC"


def test_connecting_journey_respects_minimum_transfer_time():
    results = r.search(TRAINS, "MYS", "HWH", DATE, r.SearchOptions(max_transfers=2))
    assert results
    for j in results:
        assert j.transfers >= 1
        for _, wait in j.waits:
            assert 30 <= wait <= 720


def test_pareto_set_has_no_dominated_journeys():
    for o, d in [("MAS", "NDLS"), ("SBC", "BSB"), ("CSMT", "HWH")]:
        js = r.search(TRAINS, o, d, DATE, r.SearchOptions(limit=100))
        for a in js:
            for b in js:
                if a is b:
                    continue
                assert not (b.dep >= a.dep and b.arr <= a.arr and b.transfers <= a.transfers
                            and (b.dep > a.dep or b.arr < a.arr or b.transfers < a.transfers))


def test_preferences_change_the_ranking():
    fewest = r.search(TRAINS, "MAS", "NDLS", DATE, r.SearchOptions(preference="fewest_changes"))
    assert fewest[0].transfers == min(j.transfers for j in fewest)
    fastest = r.search(TRAINS, "MAS", "NDLS", DATE, r.SearchOptions(preference="fastest", limit=100))
    assert fastest[0].duration + 30 * fastest[0].transfers == min(j.duration + 30 * j.transfers for j in fastest)


PAIRS = [("MAS", "SBC"), ("MAS", "NDLS"), ("MYS", "HWH"), ("TVC", "BSB"), ("ADI", "PNBE"),
         ("MAQ", "GHY"), ("CBE", "JP"), ("RNC", "CSMT"), ("ERS", "LKO"), ("PUNE", "VSKP")]


@pytest.mark.parametrize("origin,dest", PAIRS)
def test_enumeration_matches_dijkstra_oracle(origin, dest):
    """With generous limits, the earliest arrival found by enumeration must equal the
    Dijkstra earliest arrival on the time-expanded graph."""
    opts = r.SearchOptions(max_transfers=4, max_wait_min=4000)
    js = r.enumerate_journeys(TRAINS, origin, dest, DATE, opts)
    oracle = r.earliest_arrival_dijkstra(TRAINS, origin, dest, DATE)
    if oracle is None:
        assert not js
    else:
        assert js, f"oracle found {oracle} but enumeration found nothing"
        assert min(j.arr for j in js) == oracle


def test_user_limits_never_beat_the_oracle():
    for o, d in PAIRS:
        js = r.enumerate_journeys(TRAINS, o, d, DATE)
        oracle = r.earliest_arrival_dijkstra(TRAINS, o, d, DATE)
        if js:
            assert min(j.arr for j in js) >= oracle


def test_same_origin_and_destination_returns_nothing():
    assert r.search(TRAINS, "MAS", "MAS", DATE) == []
