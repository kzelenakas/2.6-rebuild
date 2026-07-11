import { useEffect, useMemo, useRef } from "react";
import type { Finding, Severity } from "../types";

// Map field keys to their respective Fannie Mae Form 1004 sections
const FIELD_SECTIONS: Record<string, string> = {
  // Subject
  Address: "SUBJECT", City: "SUBJECT", State: "SUBJECT", Zip: "SUBJECT",
  Borrower: "SUBJECT", Owner: "SUBJECT", County: "SUBJECT",
  PropertyEstateType: "SUBJECT", LeaseholdRemainingTerm: "SUBJECT",
  Occupant: "SUBJECT", AssignmentType: "SUBJECT", Lender: "SUBJECT",
  SalesPrice: "SUBJECT", DateOfSignature: "SUBJECT",

  // Neighborhood
  Location: "NEIGHBORHOOD", BuiltUp: "NEIGHBORHOOD", Growth: "NEIGHBORHOOD",
  PropertyValues: "NEIGHBORHOOD", DemandSupply: "NEIGHBORHOOD", MarketingTime: "NEIGHBORHOOD",
  NeighborhoodBoundaries: "NEIGHBORHOOD", OneUnitHousingHigh: "NEIGHBORHOOD",
  OneUnitHousingLow: "NEIGHBORHOOD", OneUnitHousingPred: "NEIGHBORHOOD",

  // Site
  Dimensions: "SITE", Area: "SITE", Shape: "SITE", View: "SITE",
  ZoningClassification: "SITE", ZoningCompliance: "SITE",
  UtilitiesWater: "SITE", UtilitiesSewer: "SITE", FemaFloodZone: "SITE", FemaSpecialFlood: "SITE",

  // Improvements
  YearBuilt: "IMPROVEMENTS", EffectiveAge: "IMPROVEMENTS", DesignStyle: "IMPROVEMENTS",
  Gla: "IMPROVEMENTS", RoomCount: "IMPROVEMENTS", BedroomCount: "IMPROVEMENTS",
  BathroomCount: "IMPROVEMENTS", BasementGla: "IMPROVEMENTS", CarStorage: "IMPROVEMENTS",
  PhysicalCondition: "IMPROVEMENTS",

  // Sales Comparison
  Comp1Address: "SALES_COMPARISON", Comp1Price: "SALES_COMPARISON", Comp1Proximity: "SALES_COMPARISON", Comp1Gla: "SALES_COMPARISON", Comp1SaleDate: "SALES_COMPARISON",
  Comp2Address: "SALES_COMPARISON", Comp2Price: "SALES_COMPARISON", Comp2Proximity: "SALES_COMPARISON", Comp2Gla: "SALES_COMPARISON", Comp2SaleDate: "SALES_COMPARISON",
  Comp3Address: "SALES_COMPARISON", Comp3Price: "SALES_COMPARISON", Comp3Proximity: "SALES_COMPARISON", Comp3Gla: "SALES_COMPARISON", Comp3SaleDate: "SALES_COMPARISON",
};

interface PDFPreviewProps {
  run: any;
  activeFinding: Finding | null;
}

export function PDFPreview({ run, activeFinding }: PDFPreviewProps) {
  // Generate unified report values by merging defaults with actual finding values
  const reportData = useMemo(() => {
    const base = {
      // Subject Section
      Address: "1248 Pinecrest Avenue",
      City: "San Francisco",
      State: "CA",
      Zip: "94118",
      Borrower: "Sarah Jenkins",
      Owner: "Robert & Sarah Jenkins",
      County: "San Francisco",
      MapReference: "Page 42, Grid B3",
      CensusTract: "0312.02",
      PropertyEstateType: "Fee Simple",
      LeaseholdRemainingTerm: "",
      Occupant: "Owner",
      AssignmentType: "Purchase",
      Lender: "True Footage Mortgage Corp",
      SalesPrice: "1,250,000",
      DateOfSignature: "2026-07-10",

      // Neighborhood Section
      Location: "Suburban",
      BuiltUp: "25-75%",
      Growth: "Stable",
      PropertyValues: "Stable",
      DemandSupply: "In Balance",
      MarketingTime: "3-6 mths",
      NeighborhoodBoundaries: "North: Geary Blvd, South: Fulton St, East: Park Presidio, West: Great Highway",
      OneUnitHousingHigh: "1,600,000",
      OneUnitHousingLow: "950,000",
      OneUnitHousingPred: "1,200,000",

      // Site Section
      Dimensions: "50 x 120",
      Area: "6,000 sq ft",
      Shape: "Rectangular",
      View: "Residential / City View",
      ZoningClassification: "RH-2",
      ZoningCompliance: "Conforming",
      UtilitiesWater: "Public",
      UtilitiesSewer: "Public",
      FemaFloodZone: "Zone X",
      FemaSpecialFlood: "No",

      // Improvements Section
      YearBuilt: "1954",
      EffectiveAge: "15",
      DesignStyle: "Edwardian / Craftsman",
      Gla: "2,150",
      RoomCount: "7",
      BedroomCount: "3",
      BathroomCount: "2.5",
      BasementGla: "450",
      CarStorage: "2 Car Garage",
      PhysicalCondition: "C3 - Well Maintained",

      // Comparable Sales
      Comp1Address: "1312 Pinecrest Avenue",
      Comp1Price: "1,260,000",
      Comp1Proximity: "1 block North",
      Comp1Gla: "2,100",
      Comp1SaleDate: "05/26",

      Comp2Address: "945 Fulton Street",
      Comp2Price: "1,220,000",
      Comp2Proximity: "3 blocks South",
      Comp2Gla: "2,200",
      Comp2SaleDate: "04/26",

      Comp3Address: "411 Cabrillo Street",
      Comp3Price: "1,295,000",
      Comp3Proximity: "0.4 miles West",
      Comp3Gla: "2,350",
      Comp3SaleDate: "06/26"
    };

    if (!run) return base;

    const merged = { ...base };
    const findings = run.findings || [];

    // Layer all finding values to show real parsed XML values
    for (const f of findings) {
      if (f.values) {
        for (const [k, v] of Object.entries(f.values)) {
          if (v !== null && v !== undefined) {
            merged[k as keyof typeof base] = String(v);
          }
        }
      }
    }
    return merged;
  }, [run]);

  // Determine active sections and fields to highlight
  const activeHighlightKeys = useMemo(() => {
    if (!activeFinding || !activeFinding.values) return [];
    return Object.keys(activeFinding.values);
  }, [activeFinding]);

  // Determine which sections are involved
  const activeSections = useMemo(() => {
    if (activeHighlightKeys.length === 0) {
      if (activeFinding?.section) {
        // Fallback to finding's general section
        const sec = activeFinding.section.toUpperCase();
        if (["SUBJECT", "NEIGHBORHOOD", "SITE", "IMPROVEMENTS", "SALES_COMPARISON"].includes(sec)) {
          return [sec];
        }
      }
      return ["SUBJECT"]; // Default view
    }

    const sections = new Set<string>();
    for (const key of activeHighlightKeys) {
      const sec = FIELD_SECTIONS[key];
      if (sec) {
        sections.add(sec);
      }
    }

    if (sections.size === 0 && activeFinding?.section) {
      const sec = activeFinding.section.toUpperCase();
      if (["SUBJECT", "NEIGHBORHOOD", "SITE", "IMPROVEMENTS", "SALES_COMPARISON"].includes(sec)) {
        return [sec];
      }
    }

    return Array.from(sections);
  }, [activeHighlightKeys, activeFinding]);

  const isMultiFieldSplit = activeSections.length > 1;

  // Refs to handle scrolling to highlighted sections/fields
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeHighlightKeys.length > 0) {
      setTimeout(() => {
        // Scroll first highlight in top container
        const firstKey = activeHighlightKeys[0];
        const topEl = topScrollRef.current?.querySelector(`[data-field="${firstKey}"]`);
        if (topEl) {
          topEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        // Scroll second highlight in bottom container if split-screen is active
        if (isMultiFieldSplit && activeHighlightKeys.length > 1) {
          const secondKey = activeHighlightKeys[1];
          const bottomEl = bottomScrollRef.current?.querySelector(`[data-field="${secondKey}"]`);
          if (bottomEl) {
            bottomEl.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }, 100);
    }
  }, [activeFinding, isMultiFieldSplit, activeHighlightKeys]);

  const getSeverityColorClass = (severity?: Severity) => {
    if (severity === "HardStop") return "bg-red-50 border-red-500 hover:bg-red-100/50";
    if (severity === "Warning") return "bg-amber-50 border-amber-500 hover:bg-amber-100/50";
    return "bg-sky-50 border-sky-400 hover:bg-sky-100/50";
  };

  const getPulsingClass = (key: string) => {
    const isActive = activeHighlightKeys.includes(key);
    if (!isActive) return "border-gray-200 bg-white";
    
    // Pulse highlight depending on severity
    if (activeFinding?.severity === "HardStop") {
      return "border-2 border-red-500 bg-red-100/70 shadow-xs ring-2 ring-red-400/20 z-10 animate-pulse";
    }
    if (activeFinding?.severity === "Warning") {
      return "border-2 border-amber-500 bg-amber-100/70 shadow-xs ring-2 ring-amber-400/20 z-10 animate-pulse";
    }
    return "border-2 border-sky-400 bg-sky-100/70 shadow-xs ring-2 ring-sky-300/20 z-10 animate-pulse";
  };

  // Sections Render Helpers
  const renderSubjectSection = () => (
    <div className="bg-white border border-gray-300 rounded shadow-xs overflow-hidden">
      <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 flex justify-between items-center text-xs font-bold text-gray-800">
        <span>UNIFORM RESIDENTIAL APPRAISAL REPORT - SUBJECT PROPERTY</span>
        <span className="text-[10px] text-gray-500 font-mono">FORM 1004 / PAGE 1</span>
      </div>
      <div className="p-3 grid grid-cols-4 gap-2 text-xs">
        <div className={`col-span-2 border p-1.5 rounded transition-all ${getPulsingClass("Address")}`} data-field="Address">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Property Address</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.Address}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("City")}`} data-field="City">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">City</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.City}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("State")}`} data-field="State">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">State / Zip</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.State} {reportData.Zip}</span>
        </div>

        <div className={`col-span-2 border p-1.5 rounded transition-all ${getPulsingClass("Borrower")}`} data-field="Borrower">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Borrower Name</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.Borrower}</span>
        </div>
        <div className={`col-span-2 border p-1.5 rounded transition-all ${getPulsingClass("Owner")}`} data-field="Owner">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Owner of Public Record</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.Owner}</span>
        </div>

        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("County")}`} data-field="County">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">County</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.County}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("MapReference")}`} data-field="MapReference">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Map Reference</label>
          <span className="font-mono text-gray-800 font-semibold">{reportData.MapReference}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("CensusTract")}`} data-field="CensusTract">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Census Tract</label>
          <span className="font-mono text-gray-800 font-semibold">{reportData.CensusTract}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Occupant")}`} data-field="Occupant">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Occupant Status</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.Occupant}</span>
        </div>

        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("PropertyEstateType")}`} data-field="PropertyEstateType">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Property Rights / Estate</label>
          <span className="font-mono text-gray-900 font-extrabold text-emerald-700">{reportData.PropertyEstateType}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("LeaseholdRemainingTerm")}`} data-field="LeaseholdRemainingTerm">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Leasehold Exp / Term</label>
          <span className="font-mono text-red-700 font-bold">
            {reportData.LeaseholdRemainingTerm || <span className="text-gray-300 italic font-normal">(blank)</span>}
          </span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("AssignmentType")}`} data-field="AssignmentType">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Assignment Type</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.AssignmentType}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("SalesPrice")}`} data-field="SalesPrice">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Contract Price</label>
          <span className="font-mono text-gray-900 font-black text-xs">${reportData.SalesPrice}</span>
        </div>

        <div className={`col-span-3 border p-1.5 rounded transition-all ${getPulsingClass("Lender")}`} data-field="Lender">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Lender / Client</label>
          <span className="font-mono text-gray-800 font-semibold">{reportData.Lender}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("DateOfSignature")}`} data-field="DateOfSignature">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Signature Date</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.DateOfSignature}</span>
        </div>
      </div>
    </div>
  );

  const renderNeighborhoodSection = () => (
    <div className="bg-white border border-gray-300 rounded shadow-xs overflow-hidden">
      <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 flex justify-between items-center text-xs font-bold text-gray-800">
        <span>URAR SECTION - NEIGHBORHOOD STATUS & TRENDS</span>
        <span className="text-[10px] text-gray-500 font-mono">FORM 1004 / PAGE 1</span>
      </div>
      <div className="p-3 grid grid-cols-3 gap-2 text-xs">
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Location")}`} data-field="Location">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Location Characteristics</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.Location}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("BuiltUp")}`} data-field="BuiltUp">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Built-up Ratio</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.BuiltUp}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Growth")}`} data-field="Growth">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Growth Pace</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.Growth}</span>
        </div>

        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("PropertyValues")}`} data-field="PropertyValues">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Property Values</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.PropertyValues}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("DemandSupply")}`} data-field="DemandSupply">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Demand / Supply Balance</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.DemandSupply}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("MarketingTime")}`} data-field="MarketingTime">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Avg Marketing Time</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.MarketingTime}</span>
        </div>

        <div className={`col-span-3 border p-1.5 rounded transition-all ${getPulsingClass("NeighborhoodBoundaries")}`} data-field="NeighborhoodBoundaries">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Neighborhood Boundary Narrative</label>
          <span className="font-mono text-gray-900 font-semibold leading-relaxed">{reportData.NeighborhoodBoundaries}</span>
        </div>

        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("OneUnitHousingLow")}`} data-field="OneUnitHousingLow">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">One-Unit Price Range: Low</label>
          <span className="font-mono text-gray-800 font-semibold">${reportData.OneUnitHousingLow}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("OneUnitHousingHigh")}`} data-field="OneUnitHousingHigh">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">One-Unit Price Range: High</label>
          <span className="font-mono text-gray-800 font-semibold">${reportData.OneUnitHousingHigh}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("OneUnitHousingPred")}`} data-field="OneUnitHousingPred">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">One-Unit Housing: Predominant</label>
          <span className="font-mono text-gray-900 font-bold">${reportData.OneUnitHousingPred}</span>
        </div>
      </div>
    </div>
  );

  const renderSiteSection = () => (
    <div className="bg-white border border-gray-300 rounded shadow-xs overflow-hidden">
      <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 flex justify-between items-center text-xs font-bold text-gray-800">
        <span>URAR SECTION - SITE SITE SITE</span>
        <span className="text-[10px] text-gray-500 font-mono">FORM 1004 / PAGE 1</span>
      </div>
      <div className="p-3 grid grid-cols-4 gap-2 text-xs">
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Dimensions")}`} data-field="Dimensions">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Site Dimensions</label>
          <span className="font-mono text-gray-800 font-semibold">{reportData.Dimensions}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Area")}`} data-field="Area">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Site Area</label>
          <span className="font-mono text-gray-800 font-semibold">{reportData.Area}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Shape")}`} data-field="Shape">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Site Shape</label>
          <span className="font-mono text-gray-800 font-semibold">{reportData.Shape}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("View")}`} data-field="View">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Property View</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.View}</span>
        </div>

        <div className={`col-span-2 border p-1.5 rounded transition-all ${getPulsingClass("ZoningClassification")}`} data-field="ZoningClassification">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Zoning Classification</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.ZoningClassification}</span>
        </div>
        <div className={`col-span-2 border p-1.5 rounded transition-all ${getPulsingClass("ZoningCompliance")}`} data-field="ZoningCompliance">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Zoning Compliance</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.ZoningCompliance}</span>
        </div>

        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("UtilitiesWater")}`} data-field="UtilitiesWater">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Water Utility</label>
          <span className="font-mono text-gray-800">{reportData.UtilitiesWater}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("UtilitiesSewer")}`} data-field="UtilitiesSewer">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Sanitary Sewer</label>
          <span className="font-mono text-gray-800">{reportData.UtilitiesSewer}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("FemaSpecialFlood")}`} data-field="FemaSpecialFlood">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">FEMA Special Flood Area</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.FemaSpecialFlood}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("FemaFloodZone")}`} data-field="FemaFloodZone">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">FEMA Flood Zone</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.FemaFloodZone}</span>
        </div>
      </div>
    </div>
  );

  const renderImprovementsSection = () => (
    <div className="bg-white border border-gray-300 rounded shadow-xs overflow-hidden">
      <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 flex justify-between items-center text-xs font-bold text-gray-800">
        <span>URAR SECTION - IMPROVEMENTS DESCRIPTION</span>
        <span className="text-[10px] text-gray-500 font-mono">FORM 1004 / PAGE 1</span>
      </div>
      <div className="p-3 grid grid-cols-4 gap-2 text-xs">
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("YearBuilt")}`} data-field="YearBuilt">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Year Built</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.YearBuilt}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("EffectiveAge")}`} data-field="EffectiveAge">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Effective Age (Yrs)</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.EffectiveAge}</span>
        </div>
        <div className={`col-span-2 border p-1.5 rounded transition-all ${getPulsingClass("DesignStyle")}`} data-field="DesignStyle">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Design / Style</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.DesignStyle}</span>
        </div>

        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("RoomCount")}`} data-field="RoomCount">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Total Rooms</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.RoomCount}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("BedroomCount")}`} data-field="BedroomCount">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Bedrooms</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.BedroomCount}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("BathroomCount")}`} data-field="BathroomCount">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Bathrooms</label>
          <span className="font-mono text-gray-900 font-bold">{reportData.BathroomCount}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Gla")}`} data-field="Gla">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">GLA (Gross Living Area)</label>
          <span className="font-mono text-gray-900 font-black text-emerald-700">{reportData.Gla} sq ft</span>
        </div>

        <div className={`col-span-2 border p-1.5 rounded transition-all ${getPulsingClass("BasementGla")}`} data-field="BasementGla">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Basement Area / Finish</label>
          <span className="font-mono text-gray-800 font-semibold">{reportData.BasementGla} sq ft</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("CarStorage")}`} data-field="CarStorage">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Car Storage / Garage</label>
          <span className="font-mono text-gray-800">{reportData.CarStorage}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("PhysicalCondition")}`} data-field="PhysicalCondition">
          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider">Overall Condition (UAD)</label>
          <span className="font-mono text-gray-900 font-extrabold text-blue-700">{reportData.PhysicalCondition}</span>
        </div>
      </div>
    </div>
  );

  const renderSalesComparisonSection = () => (
    <div className="bg-white border border-gray-300 rounded shadow-xs overflow-hidden">
      <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 flex justify-between items-center text-xs font-bold text-gray-800">
        <span>SALES COMPARISON ANALYSIS - COMPARABLE SALES GRID</span>
        <span className="text-[10px] text-gray-500 font-mono">FORM 1004 / PAGE 2</span>
      </div>
      <div className="p-3 grid grid-cols-4 gap-2 text-[11px]">
        {/* Row 1 Headers */}
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-bold text-gray-600 uppercase tracking-wide flex items-center justify-center text-center">
          Feature
        </div>
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-bold text-gray-700 text-center">
          Comparable 1
        </div>
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-bold text-gray-700 text-center">
          Comparable 2
        </div>
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-bold text-gray-700 text-center">
          Comparable 3
        </div>

        {/* Address Row */}
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-semibold text-gray-700">
          Address
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp1Address")}`} data-field="Comp1Address">
          <span className="font-mono text-gray-900 font-bold block truncate">{reportData.Comp1Address}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp2Address")}`} data-field="Comp2Address">
          <span className="font-mono text-gray-900 font-bold block truncate">{reportData.Comp2Address}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp3Address")}`} data-field="Comp3Address">
          <span className="font-mono text-gray-900 font-bold block truncate">{reportData.Comp3Address}</span>
        </div>

        {/* Price Row */}
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-semibold text-gray-700">
          Sales Price
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp1Price")}`} data-field="Comp1Price">
          <span className="font-mono text-gray-900 font-black text-emerald-800 block">${reportData.Comp1Price}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp2Price")}`} data-field="Comp2Price">
          <span className="font-mono text-gray-900 font-black text-emerald-800 block">${reportData.Comp2Price}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp3Price")}`} data-field="Comp3Price">
          <span className="font-mono text-gray-900 font-black text-emerald-800 block">${reportData.Comp3Price}</span>
        </div>

        {/* Proximity Row */}
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-semibold text-gray-700">
          Proximity
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp1Proximity")}`} data-field="Comp1Proximity">
          <span className="font-mono text-gray-800 block truncate">{reportData.Comp1Proximity}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp2Proximity")}`} data-field="Comp2Proximity">
          <span className="font-mono text-gray-800 block truncate">{reportData.Comp2Proximity}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp3Proximity")}`} data-field="Comp3Proximity">
          <span className="font-mono text-gray-800 block truncate">{reportData.Comp3Proximity}</span>
        </div>

        {/* GLA Row */}
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-semibold text-gray-700">
          GLA (Living Area)
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp1Gla")}`} data-field="Comp1Gla">
          <span className="font-mono text-gray-900 font-bold block">{reportData.Comp1Gla} sq ft</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp2Gla")}`} data-field="Comp2Gla">
          <span className="font-mono text-gray-900 font-bold block">{reportData.Comp2Gla} sq ft</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp3Gla")}`} data-field="Comp3Gla">
          <span className="font-mono text-gray-900 font-bold block">{reportData.Comp3Gla} sq ft</span>
        </div>

        {/* Sale Date Row */}
        <div className="bg-gray-50 p-1.5 border rounded border-gray-200 font-semibold text-gray-700">
          Sale Date (UAD)
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp1SaleDate")}`} data-field="Comp1SaleDate">
          <span className="font-mono text-gray-800 block">{reportData.Comp1SaleDate}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp2SaleDate")}`} data-field="Comp2SaleDate">
          <span className="font-mono text-gray-800 block">{reportData.Comp2SaleDate}</span>
        </div>
        <div className={`border p-1.5 rounded transition-all ${getPulsingClass("Comp3SaleDate")}`} data-field="Comp3SaleDate">
          <span className="font-mono text-gray-800 block">{reportData.Comp3SaleDate}</span>
        </div>
      </div>
    </div>
  );

  const renderSectionByTitle = (secName: string) => {
    switch (secName) {
      case "SUBJECT": return renderSubjectSection();
      case "NEIGHBORHOOD": return renderNeighborhoodSection();
      case "SITE": return renderSiteSection();
      case "IMPROVEMENTS": return renderImprovementsSection();
      case "SALES_COMPARISON": return renderSalesComparisonSection();
      default: return renderSubjectSection();
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-100 border border-gray-300 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-[#24252f] text-white px-4 py-3 flex items-center justify-between border-b border-gray-300 shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
          <h2 className="text-xs font-black uppercase tracking-wider">Fannie Mae 1004 PDF Form Preview</h2>
        </div>
        <div className="flex gap-1">
          <span className="text-[9px] font-bold bg-indigo-600/30 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">
            Interactive Linked Document
          </span>
          {isMultiFieldSplit && (
            <span className="text-[9px] font-bold bg-emerald-600/30 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/20">
              Split Screen Active
            </span>
          )}
        </div>
      </div>

      {/* Main Document area */}
      <div className="flex-1 flex flex-col min-h-0 bg-gray-200">
        {isMultiFieldSplit ? (
          /* SPLIT SCREEN MODE FOR MULTI-FIELD RULES */
          <div className="h-full flex flex-col divide-y-4 divide-indigo-600">
            {/* Top Split Pane */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative">
              <div className="bg-indigo-900/10 text-indigo-950 px-3 py-1 font-bold text-[10px] uppercase tracking-wider flex justify-between items-center bg-gray-100/90 border-b border-gray-200 shrink-0 select-none">
                <span>Pane 1: {activeSections[0]} Section</span>
                <span className="text-[9px] font-medium text-indigo-600">Scrolled to highlight</span>
              </div>
              <div 
                ref={topScrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-100 scrollbar-thin"
              >
                {renderSectionByTitle(activeSections[0])}
              </div>
            </div>

            {/* Bottom Split Pane */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative">
              <div className="bg-indigo-900/10 text-indigo-950 px-3 py-1 font-bold text-[10px] uppercase tracking-wider flex justify-between items-center bg-gray-100/90 border-b border-gray-200 shrink-0 select-none">
                <span>Pane 2: {activeSections[1] || activeSections[0]} Section</span>
                <span className="text-[9px] font-medium text-indigo-600">Scrolled to highlight</span>
              </div>
              <div 
                ref={bottomScrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-100 scrollbar-thin"
              >
                {renderSectionByTitle(activeSections[1] || activeSections[0])}
              </div>
            </div>
          </div>
        ) : (
          /* STANDARD SINGLE PANORAMIC REPORT VIEW */
          <div 
            ref={topScrollRef}
            className="h-full overflow-y-auto p-5 space-y-5 bg-gray-100 scrollbar-thin scroll-smooth"
          >
            {/* Display banner matching selected rule location if any */}
            {activeFinding && (
              <div className={`p-3 rounded-lg border text-xs flex items-center gap-2.5 ${getSeverityColorClass(activeFinding.severity)}`}>
                <span className="text-lg">🎯</span>
                <div>
                  <div className="font-bold">Linked to Rule: {activeFinding.rule_id} ({activeFinding.severity})</div>
                  <div className="text-gray-600 text-[11px] mt-0.5">{activeFinding.message_appraiser}</div>
                </div>
              </div>
            )}

            {renderSubjectSection()}
            {renderNeighborhoodSection()}
            {renderSiteSection()}
            {renderImprovementsSection()}
            {renderSalesComparisonSection()}
          </div>
        )}
      </div>
    </div>
  );
}
