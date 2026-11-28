"""Google Maps handoff links, and routing with imported-style data (unknown distances,
unknown running days, station names from the catalogue, scheduled provenance)."""

from datetime import date
from urllib.parse import parse_qs, urlparse

import pytest

from payani.core import maps
from payani.domain import routing
from payani.domain.catalog_synth import Stop, Train, generate_trains


def test_place_url_prefers_coordinates_and_needs_no_key():
    url = maps.place_url("Chennai Central", 13.0827, 80.2707)
    parts = urlparse(url)
    assert parts.scheme == "https" and parts.netloc == "www.google.com" and parts.path == "/maps/search/"
    q = parse_qs(parts.query)
    assert q == {"api": ["1"], "query": ["13.08270,80.27070"]}
    assert "key" not in url.lower()


def test_place_url_falls_back_to_name():
    q = parse_qs(urlparse(maps.place_url("Itarsi Junction")).query)
    assert q["query"] == ["Itarsi Junction railway station"]
    q = parse_qs(urlparse(maps.place_url("Howrah Station")).query)
    assert q["query"] == ["Howrah Station"]
    with pytest.raises(ValueError):
        maps.place_url(None)


def test_directions_url():
    url = maps.directions_url(("New Delhi", 28.64, 77.22), ("Agra Cantt", None, None))
    parts = urlparse(url)
    q = parse_qs(parts.query)
    assert parts.path == "/maps/dir/"
    assert q["origin"] == ["28.64000,77.22000"] and q["destination"] == ["Agra Cantt railway station"]
    assert q["travelmode"] == ["transit"] and q["api"] == ["1"]
    with pytest.raises(ValueError):
        maps.directions_url(("A", 1, 1), ("B", 2, 2), travelmode="teleport")


def _imported():
    # Test trains in the shape the importer produces: daily (days unknown), distance only at the ends.
    a = Train("99901", "TEST ONE", "Exp", 127, ("3A",), [Stop("TSA", None, 600, 0), Stop("TSB", 700, 705, None),
                                                          Stop("TSC", 800, None, 300)], days_known=False,
              distance_basis="endpoints")
    b = Train("99902", "TEST TWO", "Exp", 127, (), [Stop("TSB", None, 760, 0), Stop("TSD", 900, None, 120)],
              days_known=False)
    return [a, b]


def test_journeys_carry_names_provenance_and_warnings():
    names = {"TSA": "Test A", "TSB": "Test B", "TSC": "Test C", "TSD": "Test D"}
    data = {"confidence": "scheduled", "source": "datameet-railways", "as_of": "2016-08-08"}
    trains = _imported()
    on = date(2026, 12, 1)
    direct = routing.search(trains, "TSA", "TSC", on, names=names)
    d = routing.journey_to_dict(direct[0], on, names, data)
    assert d["distance_km"] == 300 and d["legs"][0]["to_name"] == "Test C"
    assert d["data"]["confidence"] == "scheduled"
    assert [w["code"] for w in d["warnings"]] == ["running_days_unknown"]
    assert d["legs"][0]["running_days_known"] is False
    change = routing.search(trains, "TSA", "TSD", on, names=names)[0]
    c = routing.journey_to_dict(change, on, names, data)
    assert c["transfers"] == 1 and c["distance_km"] is None  # TSA->TSB section has no published distance
    assert {w["code"] for w in c["warnings"]} == {"running_days_unknown", "distance_unknown"}
    assert any("Test B" in r["text"] for r in c["reasons"])


def test_synthetic_journeys_stay_labelled_simulated():
    trains = generate_trains()
    on = date(2026, 12, 1)
    j = routing.search(trains, "MAS", "SBC", on)[0]
    d = routing.journey_to_dict(j, on)
    assert d["data"]["confidence"] == "simulated" and d["warnings"] == []


def test_candidate_trains_keep_every_journey_with_up_to_one_change():
    trains = generate_trains()
    on = date(2026, 12, 1)
    for origin, dest in (("MAS", "NDLS"), ("SBC", "HWH"), ("CSMT", "MAS"), ("TVC", "JP")):
        for k in (0, 1):
            opts = routing.SearchOptions(max_transfers=k, limit=1000)
            full = {j.signature for j in routing.search(trains, origin, dest, on, opts)}
            subset = routing.candidate_trains(trains, origin, dest, k)
            assert len(subset) <= len(trains)
            fast = {j.signature for j in routing.search(subset, origin, dest, on, opts)}
            assert fast == full, (origin, dest, k)
    assert routing.candidate_trains(trains, "MAS", "NDLS", 2) is trains


def test_fast_pareto_matches_the_pairwise_definition():
    trains = generate_trains()
    on = date(2026, 12, 1)
    for origin, dest in (("MAS", "NDLS"), ("SBC", "HWH"), ("CSMT", "MAS"), ("ERS", "PNBE")):
        found = routing.enumerate_journeys(trains, origin, dest, on, routing.SearchOptions(max_transfers=2))
        assert found
        fast = [j.signature for j in routing.pareto(found)]
        slow = [j.signature for j in routing.pareto_reference(found)]
        assert fast == slow, (origin, dest)
