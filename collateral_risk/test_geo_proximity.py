"""Runnable check for poi.py + the geo_proximity operator, per ponytail's rule for
non-trivial logic. Not a suite -- run directly: python test_geo_proximity.py

No network call is made: every test injects a fake `fetch` so this never depends on
Overpass being reachable.
"""
import json
import math

from lxml import etree

from collateral_risk import poi
from collateral_risk.operators import geo_proximity

SUBJECT_XML = b"""<MESSAGE>
  <VALUATION_ANALYSIS><PROPERTIES>
    <PROPERTY ValuationUseType="SubjectProperty">
      <LOCATION_IDENTIFIER><GEOSPATIAL_INFORMATION>
        <LatitudeIdentifier>25.165173</LatitudeIdentifier>
        <LongitudeIdentifier>-51.328125</LongitudeIdentifier>
      </GEOSPATIAL_INFORMATION></LOCATION_IDENTIFIER>
    </PROPERTY>
  </PROPERTIES></VALUATION_ANALYSIS>
</MESSAGE>"""


def _fake_fetch_hit(query: str) -> bytes:
    # A way "center" ~91m (~300ft) north of the subject -- inside a 500m search radius.
    return json.dumps({"elements": [{"type": "way", "center": {"lat": 25.16599, "lon": -51.328125}}]}).encode()


def _fake_fetch_miss(query: str) -> bytes:
    return json.dumps({"elements": []}).encode()


def test_haversine_known_distance():
    # 1 degree of latitude is ~364,000 ft (~69 miles) -- sanity check the constant/formula.
    d = poi.haversine_ft(0.0, 0.0, 1.0, 0.0)
    assert 360_000 < d < 370_000, f"expected ~364,000 ft, got {d}"


def test_nearest_distance_ft_uses_injected_fetch():
    dist = poi.nearest_distance_ft(25.165173, -51.328125, "airport", fetch=_fake_fetch_hit)
    assert dist is not None and dist < 350, f"expected a nearby hit, got {dist}"

    dist_none = poi.nearest_distance_ft(25.165173, -51.328125, "highway", fetch=_fake_fetch_miss)
    assert dist_none is None, "empty Overpass result should mean no hit within radius"


def test_geo_proximity_operator_triggers_within_threshold(monkeypatch):
    doc = etree.fromstring(SUBJECT_XML)
    logic = {
        "lat_field": "LOCATION_IDENTIFIER/GEOSPATIAL_INFORMATION/LatitudeIdentifier",
        "lon_field": "LOCATION_IDENTIFIER/GEOSPATIAL_INFORMATION/LongitudeIdentifier",
        "category": "airport", "threshold_ft": 300, "radius_m": 500,
    }
    import collateral_risk.poi as poi_module
    monkeypatch.setattr(poi_module, "_http_fetch", _fake_fetch_hit)
    result = geo_proximity(logic, doc)
    assert result["triggered"] is True
    assert result["values"]["category"] == "airport"


def test_geo_proximity_operator_no_trigger_when_no_poi(monkeypatch):
    doc = etree.fromstring(SUBJECT_XML)
    logic = {
        "lat_field": "LOCATION_IDENTIFIER/GEOSPATIAL_INFORMATION/LatitudeIdentifier",
        "lon_field": "LOCATION_IDENTIFIER/GEOSPATIAL_INFORMATION/LongitudeIdentifier",
        "category": "highway", "threshold_ft": 300, "radius_m": 500,
    }
    import collateral_risk.poi as poi_module
    monkeypatch.setattr(poi_module, "_http_fetch", _fake_fetch_miss)
    result = geo_proximity(logic, doc)
    assert result["triggered"] is False


def test_geo_proximity_missing_coordinates_does_not_trigger():
    doc = etree.fromstring(b"<MESSAGE><VALUATION_ANALYSIS><PROPERTIES>"
                            b"<PROPERTY ValuationUseType=\"SubjectProperty\"/>"
                            b"</PROPERTIES></VALUATION_ANALYSIS></MESSAGE>")
    logic = {
        "lat_field": "LOCATION_IDENTIFIER/GEOSPATIAL_INFORMATION/LatitudeIdentifier",
        "lon_field": "LOCATION_IDENTIFIER/GEOSPATIAL_INFORMATION/LongitudeIdentifier",
        "category": "airport", "threshold_ft": 300, "radius_m": 500,
    }
    result = geo_proximity(logic, doc)
    assert result["triggered"] is False


def _run_without_pytest():
    """Fallback so `python test_geo_proximity.py` works even without pytest installed
    (monkeypatch-dependent tests use a tiny stand-in)."""
    class _Patch:
        def __init__(self):
            self._orig = {}
        def setattr(self, obj, name, val):
            self._orig[(obj, name)] = getattr(obj, name)
            setattr(obj, name, val)
        def undo(self):
            for (obj, name), val in self._orig.items():
                setattr(obj, name, val)

    test_haversine_known_distance()
    test_nearest_distance_ft_uses_injected_fetch()
    p = _Patch()
    try:
        test_geo_proximity_operator_triggers_within_threshold(p)
        test_geo_proximity_operator_no_trigger_when_no_poi(p)
    finally:
        p.undo()
    test_geo_proximity_missing_coordinates_does_not_trigger()
    print("OK -- all geo_proximity checks passed (no network calls made)")


if __name__ == "__main__":
    _run_without_pytest()
