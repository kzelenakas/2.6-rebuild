"""UAD 2.6 field resolution. MISMO v2.6 uses VALUATION_RESPONSE root.
Namespace-agnostic local-name() matching for resilience across MISMO versions.
"""
from __future__ import annotations
from lxml import etree

def _steps(path: str) -> list[str]:
    return [s for s in path.strip("/").split("/") if s]

def _xpath(steps: list[str]) -> str:
    return "//" + "/".join(f"*[local-name()='{s}']" for s in steps)

def subject_node(doc) -> "etree._Element | None":
    """The PROPERTY container flagged as the subject.
    In UAD 2.6, subject is the first PROPERTY element (no explicit ValuationUseType)."""
    # Try PROPERTY with PropertySequenceIdentifier = "0" or "1" (subject)
    nodes = doc.xpath("//*[local-name()='PROPERTY'][@PropertySequenceIdentifier='0' or @PropertySequenceIdentifier='1']")
    if nodes:
        return nodes[0]
    # Fallback: first PROPERTY
    fallback = doc.xpath("//*[local-name()='PROPERTY']")
    return fallback[0] if fallback else None

def comparable_nodes(doc, comp_index: int = 0) -> list:
    """Get comparable sale nodes.
    In UAD 2.6, comparables are under VALUATION_METHODS/SALES_COMPARISON/COMPARABLE_SALE.
    PropertySequenceIdentifier distinguishes them: 0=subject, 1=comp1, 2=comp2, etc."""
    if comp_index == 0:
        return [subject_node(doc)]
    # For comparables, find COMPARABLE_SALE with matching PropertySequenceIdentifier
    nodes = doc.xpath(f"//*[local-name()='COMPARABLE_SALE'][@PropertySequenceIdentifier='{comp_index}']")
    return nodes

def resolve(node, field_path: str) -> list[str]:
    """All text values matching field_path under node (subject or a comparable).
    Returns a list -- callers decide how to reduce it (first, any, all, count)."""
    if node is None:
        return []
    steps = _steps(field_path)
    found = node.xpath("." + _xpath(steps))
    return [n.text for n in found if n.text is not None]

def resolve_doc(doc, field_path: str) -> list[str]:
    """Doc-wide resolution for fields outside PROPERTY (reconciliation, cost approach, etc.)."""
    steps = _steps(field_path)
    found = doc.xpath(_xpath(steps))
    return [n.text for n in found if n.text is not None]

def _resolve_subject_field(doc, field_path: str) -> list[str]:
    """Convenience: resolve field under subject property node."""
    subj = subject_node(doc)
    return resolve(subj, field_path) if subj is not None else []

def _resolve_comparable_field(doc, field_path: str, comp_index: int = 0) -> list[str]:
    """Convenience: resolve field under a comparable sale node."""
    comps = comparable_nodes(doc, comp_index)
    if comps:
        return resolve(comps[0], field_path)
    return []