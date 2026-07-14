"""Minimal UAD 3.6 field resolution. No manifest layer -- rule field keys are
plain XPath fragments (local-name()-matched, namespace-agnostic), resolved
directly against the parsed document. lxml returns all matches natively, so
repeating elements (comparables, parties, systems) are lists by default --
no first-match-only limitation to work around.
ponytail: no schema-version abstraction. This targets UAD 3.6 only; a future
version needs its own resolve.py, not a plugin system for one schema.
"""
from __future__ import annotations
from lxml import etree

def _steps(path: str) -> list[str]:
    return [s for s in path.strip("/").split("/") if s]

def _xpath(steps: list[str]) -> str:
    return "//" + "/".join(f"*[local-name()='{s}']" for s in steps)

def subject_node(doc) -> "etree._Element | None":
    """The PROPERTY container flagged as the subject. Uses @ValuationUseType,
    not document order -- see FNMA_CU_MISMO_Automation_Research.md sec. 3-4
    for why first-in-document is wrong for repeating containers."""
    nodes = doc.xpath("//*[local-name()='PROPERTY'][*[local-name()='PROPERTY_DETAIL']"
                       "/*[local-name()='PropertyValuationUseType']='SubjectProperty' or "
                       "@ValuationUseType='SubjectProperty']")
    if nodes:
        return nodes[0]
    fallback = doc.xpath("//*[local-name()='PROPERTY']")
    return fallback[0] if fallback else None

def comparable_nodes(doc, use_type: str = "SalesComparable") -> list:
    return doc.xpath(f"//*[local-name()='PROPERTY'][@ValuationUseType='{use_type}' or "
                      f"*[local-name()='PROPERTY_DETAIL']/*[local-name()='PropertyValuationUseType']='{use_type}']")

def resolve(node, field_path: str) -> list[str]:
    """All text values matching field_path under node (subject or a comparable).
    Returns a list -- callers decide how to reduce it (first, any, all, count)."""
    if node is None:
        return []
    steps = _steps(field_path)
    found = node.xpath("." + _xpath(steps))
    return [n.text for n in found if n.text is not None]

def resolve_doc(doc, field_path: str) -> list[str]:
    """Doc-wide resolution for fields outside PROPERTY (reconciliation, cost
    approach, etc. -- these are legitimately singleton containers per MISMO
    cardinality, unlike PARTY/PROPERTY)."""
    steps = _steps(field_path)
    found = doc.xpath(_xpath(steps))
    return [n.text for n in found if n.text is not None]
