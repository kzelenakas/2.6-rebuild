/**
 * Maps a UAD field key (the manifest `key` in schemas/uad36_field_manifest.json
 * — e.g. "doc:MESSAGE/.../ExecutionDate" — the same string engine.ts puts on
 * Finding.field_path) to its position on the rendered PDF, so a finding can
 * be highlighted directly on the document. bbox is in PDF points, origin
 * top-left of the page, matching react-pdf's coordinate space at scale 1.
 *
 * Source: fixtures/uad-samples/SF1_Appraisal/SF1_Appraisal_v1.4.pdf (the
 * official GSE UAD 3.6 sample package, added to this repo as a test fixture),
 * run through scripts/extract-pdf-text.mjs and matched against this
 * manifest's `label` field. That PDF renders as one "label ... value" text
 * line per field (not a graphical form with boxes), so each bbox below is
 * the whole matched *line*, not a tight box around just the value — good
 * enough to scroll/zoom a reviewer to the right spot, not a pixel-exact
 * fillable-cell highlight.
 *
 * Coverage is partial and asymmetric by design: only labels that matched
 * exactly one line in the whole document were kept (45 of 410 displayable
 * fields) — repeated labels (comp columns, etc.) were skipped rather than
 * guessed at, so this map has zero comp-grid coverage. It is also derived
 * from ONE sample report's rendering; a different appraisal software (ACI,
 * Total, ClickForms) may lay the same fields out completely differently, so
 * treat this as a starting point verified against SF1 only, not a
 * universal template — re-run the same script/match against SF3 and Condo2
 * (also in fixtures/) or a real production report to extend/cross-check it.
 * Missing entries just mean "no overlay for that finding," never a crash.
 */
export interface FieldLocation {
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export const FIELD_LOCATIONS: Record<string, FieldLocation> = {
  "doc:MESSAGE/DOCUMENT_SETS/DOCUMENT_SET/DOCUMENTS/DOCUMENT/SIGNATORIES/SIGNATORY/EXECUTION/EXECUTION_DETAIL/ExecutionDate": { page: 23, bbox: { x: 40, y: 602, width: 251, height: 9 } },
  "doc:SERVICE/PARTIES/PARTY/INDIVIDUAL/NAME/; ../SERVICE/PARTIES/PARTY/LEGAL_ENTITY/LEGAL_ENTITY_DETAIL/LastName": { page: 4, bbox: { x: 40, y: 127, width: 176, height: 9 } },
  "doc:VALUATION_ANALYSIS/VALUATION_REPORT/VALUATION_RECONCILIATION/VALUATION_RECONCILIATION_SUMMARY/VALUATION_RECONCILIATION_SUMMARY_DETAIL/MarketingOrExposureDaysCount": { page: 19, bbox: { x: 40, y: 647, width: 455, height: 9 } },
  "subject:VALUATION_ANALYSES/VALUATION_ANALYSIS/PROPERTIES/PROPERTY/LISTING_INFORMATIONS/LISTING_INFORMATION/LISTING_INFORMATION_DETAIL/ListingEndDate": { page: 15, bbox: { x: 40, y: 100, width: 531, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ADDRESS/CountyName": { page: 4, bbox: { x: 40, y: 616, width: 422, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ENERGY_EFFICIENCY_AND_GREEN/ENERGY_EFFICIENCY_AND_GREEN_DETAIL/GreenCertificationExistsIndicator": { page: 6, bbox: { x: 40, y: 101, width: 197, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ENERGY_EFFICIENCY_AND_GREEN/ENERGY_EFFICIENCY_AND_GREEN_DETAIL/RenewableEnergyComponentExistsIndicator": { page: 6, bbox: { x: 40, y: 88, width: 197, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ENERGY_EFFICIENCY_AND_GREEN/RENEWABLE_ENERGY_COMPONENTS/RENEWABLE_ENERGY_COMPONENT/RenewableEnergyComponentOwnershipTypeOtherDescription": { page: 4, bbox: { x: 40, y: 782, width: 80, height: 10 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/HOMEOWNERS_ASSOCIATIONS/HOMEOWNERS_ASSOCIATION/ASSOCIATION_CHARGES/ASSOCIATION_CHARGE/ASSOCIATION_CHARGE_DETAIL/AssociationChargeAmount": { page: 14, bbox: { x: 48, y: 710, width: 147, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/LEVELS/LEVEL/LevelType": { page: 9, bbox: { x: 40, y: 216, width: 497, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/PROPERTY_UNIT_AREA/UnitAboveGradeUnfinishedAreaMeasure": { page: 9, bbox: { x: 48, y: 114, width: 414, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/PROPERTY_UNIT_AREA/UnitBelowGradeUnfinishedAreaMeasure": { page: 9, bbox: { x: 48, y: 140, width: 414, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/PROPERTY_UNIT_DETAIL/BedroomCount": { page: 9, bbox: { x: 48, y: 114, width: 414, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/PROPERTY_UNIT_DETAIL/FullBathroomCount": { page: 9, bbox: { x: 48, y: 127, width: 414, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/PROPERTY_UNIT_DETAIL/HalfBathroomCount": { page: 9, bbox: { x: 48, y: 140, width: 414, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/PROPERTY_UNIT_DETAIL/InteriorConditionRatingCode": { page: 9, bbox: { x: 40, y: 400, width: 427, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/PROPERTY_UNIT_DETAIL/InteriorQualityRatingCode": { page: 9, bbox: { x: 40, y: 400, width: 427, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/PROPERTY_UNITS/PROPERTY_UNIT/ROOMS/ROOM/ROOM_DETAIL/RoomUpdatedTimeframeType": { page: 9, bbox: { x: 40, y: 452, width: 532, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/STRUCTURE/STRUCTURE_DETAIL/ExteriorConditionRatingCode": { page: 8, bbox: { x: 40, y: 108, width: 427, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/STRUCTURE/STRUCTURE_DETAIL/ExteriorQualityRatingCode": { page: 8, bbox: { x: 40, y: 108, width: 427, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/STRUCTURE/STRUCTURE_DETAIL/FrontDoorApproximateElevationRangeType": { page: 7, bbox: { x: 40, y: 799, width: 165, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/IMPROVEMENTS/IMPROVEMENT/SYSTEM/SYSTEM_DETAIL/CoreHeatingSystemBelowGradeIndicator": { page: 8, bbox: { x: 40, y: 310, width: 414, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/LISTING_INFORMATIONS/LISTING_INFORMATION/LISTING_INFORMATION_DETAIL/ListingTypeOtherDescription": { page: 15, bbox: { x: 40, y: 100, width: 531, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/MARKET/MARKET_INVENTORIES/MARKET_INVENTORY/MarketInventoryHighestPriceAmount": { page: 13, bbox: { x: 48, y: 160, width: 420, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/MARKET/MARKET_INVENTORIES/MARKET_INVENTORY/MarketInventoryLowestPriceAmount": { page: 13, bbox: { x: 48, y: 134, width: 443, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/MARKET/MARKET_INVENTORIES/MARKET_INVENTORY/MarketInventoryMedianPriceAmount": { page: 13, bbox: { x: 48, y: 147, width: 442, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/MARKET/MARKET_TREND/MarketSupplyTrendType": { page: 13, bbox: { x: 40, y: 268, width: 478, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/MARKET/MARKET_TREND/MarketTrendsForeclosureActivityIndicator": { page: 13, bbox: { x: 48, y: 160, width: 420, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/PARCELS/PARCEL/PARCEL_DETAIL/ParcelAreaMeasure": { page: 5, bbox: { x: 40, y: 107, width: 403, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/PARCELS/PARCEL/PARCEL_IDENTIFICATIONS/PARCEL_IDENTIFICATION/ParcelIdentifier": { page: 5, bbox: { x: 40, y: 107, width: 403, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/PROPERTY_DEFECT/DEFECTS/DEFECT/DEFECT_DETAIL/DefectItemAffectsSoundnessStructuralIntegrityIndicator": { page: 2, bbox: { x: 90, y: 596, width: 433, height: 11 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/PROPERTY_DEFECT/DEFECTS/DEFECT/DEFECT_DETAIL/DefectItemRecommendedActionType": { page: 2, bbox: { x: 90, y: 700, width: 422, height: 11 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/PROPERTY_DETAIL/NativeAmericanLandsIndicator": { page: 4, bbox: { x: 40, y: 706, width: 144, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/PROPERTY_DETAIL/PriorSalesOrTransfersIndicator": { page: 15, bbox: { x: 40, y: 468, width: 162, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/PROPERTY_GROUND_RENT/PropertyGroundLeaseRenewableIndicator": { page: 6, bbox: { x: 40, y: 88, width: 197, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/PROPERTY_TAXES/PROPERTY_TAX/PROPERTY_TAX_DETAIL/SpecialTaxAssessmentsIndicator": { page: 4, bbox: { x: 40, y: 629, width: 428, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SALES_CONTRACTS/SALES_CONTRACT/SALES_CONTRACT_DETAIL/AllPropertyRightsAppraisedIndicator": { page: 4, bbox: { x: 40, y: 798, width: 429, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SALES_CONTRACTS/SALES_CONTRACT/SALES_CONTRACT_DETAIL/SalesConcessionIndicator": { page: 15, bbox: { x: 40, y: 303, width: 153, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SALES_CONTRACTS/SALES_CONTRACT/SALES_CONTRACT_DETAIL/SalesContractExistsIndicator": { page: 15, bbox: { x: 40, y: 219, width: 458, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SALES_CONTRACTS/SALES_CONTRACT/SALES_CONTRACT_DETAIL/SalesContractReviewedIndicator": { page: 15, bbox: { x: 40, y: 232, width: 490, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SITE/HIGHEST_AND_BEST_USE/SiteHighestBestUseIndicator": { page: 12, bbox: { x: 40, y: 699, width: 505, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SITE/SITE_DETAIL/BroadbandInternetAvailableIndicator": { page: 5, bbox: { x: 40, y: 440, width: 153, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SITE/SITE_SIZE_LAYOUT/LotSizeAreaMeasure": { page: 5, bbox: { x: 40, y: 88, width: 422, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SITE/SITE_SIZE_LAYOUT/ParcelCount": { page: 5, bbox: { x: 40, y: 88, width: 422, height: 9 } },
  "subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/SITE/SITE_ZONING/SITE_ZONING_DETAIL/SiteZoningClassificationDescription": { page: 5, bbox: { x: 48, y: 174, width: 421, height: 9 } },
};

export function getFieldLocation(fieldKey: string | null | undefined): FieldLocation | null {
  if (!fieldKey) return null;
  return FIELD_LOCATIONS[fieldKey] ?? null;
}
