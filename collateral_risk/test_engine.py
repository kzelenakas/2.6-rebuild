"""One runnable check, per ponytail's rule for non-trivial logic. Not a
suite -- run directly: python test_engine.py"""
from lxml import etree
from collateral_risk import evaluate

def demo():
    xml = b"""<MESSAGE>
      <VALUATION_ANALYSIS><PROPERTIES>
        <PROPERTY ValuationUseType="SubjectProperty">
          <PROPERTY_DETAIL><OverallConditionRatingCode>C9</OverallConditionRatingCode></PROPERTY_DETAIL>
          <INSPECTIONS><INSPECTION><INSPECTION_DETAIL><InspectionDate>2026-08-01</InspectionDate></INSPECTION_DETAIL></INSPECTION></INSPECTIONS>
        </PROPERTY>
      </PROPERTIES>
      <VALUATION_REPORT><VALUATION_RECONCILIATION><VALUATION_RECONCILIATION_SUMMARY>
        <VALUATION_RECONCILIATION_SUMMARY_DETAIL>
          <AppraisalReportEffectiveDate>2026-07-01</AppraisalReportEffectiveDate>
        </VALUATION_RECONCILIATION_SUMMARY_DETAIL>
      </VALUATION_RECONCILIATION_SUMMARY></VALUATION_RECONCILIATION></VALUATION_REPORT>
      </VALUATION_ANALYSIS></MESSAGE>"""
    findings = evaluate(xml)
    ids = {f["rule_id"] for f in findings}
    assert "CR-030" in ids, "invalid condition code (C9) should trigger CR-030"
    assert "CR-081" in ids, "inspection after effective date should trigger CR-081"
    print(f"OK -- {len(findings)} findings, includes {sorted(ids)}")

if __name__ == "__main__":
    demo()
