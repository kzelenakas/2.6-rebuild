import fs from "fs";
import path from "path";
import crypto from "crypto";

const RAW_RULES = [
  "Heating system information appears incomplete or inconsistent. Please review the Heating System and Heating Detail (fuel/type) selections to ensure they accurately describe the property's heating.",
  "Apparent Environmental conditions differ between the subject and one or more comparables, but no adjustment or supporting commentary was provided.",
  "Please confirm the AMC name and address listed in the appraisal report matches with the details in the order record.",
  "A heating system is reported. Please verify that the Core Heating System Below Grade field is completed correctly.",
  "The Other Mechanical Systems section is displayed. Please verify that the listed mechanical system(s) are correct.",
  "Check if the bedroom count for the subject and all comparables is provided. If there’s a difference, confirm that adjustment or a supporting comment is present.",
  "Comp #n is missing from the Sales Comparable Map or has missing/mismatched location data.",
  "One or more comps marked as excluded in the ‘Additional Properties Analyzed Not Used’ section also appear in the Sales Comparison Grid.",
  "A defect affecting the soundness or structural integrity of the dwelling is reported. Verify that the Exterior Condition Rating appropriately reflects the severity of the reported issue.",
  "Please confirm that all comparable addresses listed in the Sales Comparison Grid also appear on the Location Map.",
  "The subject is a single-section MH Advantage or CHOICEHome manufactured home. Per agency guidelines, an attached garage or carport is required for single-section MH Advantage and CHOICEHome properties. Please confirm this feature is present and documented in the appraisal report.",
  "There is a potential inconsistency between the reported Interior Quality Rating and the quality suggested by the subject interior photos. Please review the interior photos to confirm that the reported interior quality rating is accurate.",
  "There is an inconsistency between the subject’s reported exterior quality rating and the AI photo-based quality prediction. Please review the subject exterior photos to confirm whether the reported exterior quality rating is accurate and supported.",
  "The following comparables have features which vary from the subject, but have not been adjusted for in the sales comparison grid, and no commentary regarding the lack of adjustment was found. Comp #{}: {comp feature}",
  "A pool is listed as a common amenity for this project but no pool photo was detected. Please verify a pool photo is included in the Project Information Exhibits section.",
  "One or more images could not be matched between the report and the submitted zip folder. Please verify that all report images are included in the zip and all zip images are referenced in the report.",
  "Please verify that the required Sales Comparison Map image is included in the appraisal report. The map must show the subject property and all comparable sales.",
  "There is an inconsistency between the subject's reported condition rating and the AI photo-based condition prediction. Please review the subject property photos to confirm whether the condition rating in the report is accurate and supported.",
  "The comparable quality rating in the report may differ from the quality suggested by the comparable photos. Please review the photos and confirm the reported quality rating is appropriate.",
  "The subject occupancy reported in the appraisal may not match what is indicated in the subject property photos. Please review the photos and confirm the reported occupancy status is correct.",
  "Subject property has non-residential use indicated. Verify this designation is correct and supporting description/comments is provided.",
  "Check if the appraiser name in the signature section matches the name on the license/certificate.",
  "Please confirm the report includes a photo of the fence. If a fence is present on the property, a photo should be included in the Subject Property Amenities Exhibits section.",
  "The subject is a single-unit manufactured home. Verify that the appraisal report includes a HUD Data Plate photo.",
  "The subject is a manufactured home and the report indicates it has been moved from its original installation site. A manufactured home that has been relocated after its original installation is ineligible for conventional financing per agency guidelines. Please review and address.",
  "A comparable photo address in the report does not match the address listed in the Sales Comparison Approach. Confirm each Comparable in the report has a corresponding comp photo, and the address shown on the photo label (including any unit number, if applicable) matches the comparable’s address in the grid.",
  "Please confirm the report includes a photo of the pool. If a pool is present on the property, a photo should be included in the Subject Property Amenities Exhibits section.",
  "One or more Outdoor Living amenities (Deck, Patio, or Porch) are checked but a corresponding photo was not detected. Please confirm the appraisal includes a photo for each listed outdoor living amenity.",
  "The Finished Above Grade Standard and Nonstandard values in the Unit Interior Area Breakdown are identical. Please verify that these values are not duplicated - Standard and Nonstandard areas must represent different portions of the finished area above grade.",
  "The subject occupancy reported in the appraisal does not match subject property photos. Please review the photos and confirm the reported occupancy status is correct.",
  "There appears to be an inconsistency with the condition and/or quality adjustment(s) for one or more comparables. Please review.",
  "The ADU reported on this property is not confirmed as real property in the appraisal data. Verify that the ADU is classified as real property and not personal property.",
  "The comparable condition rating in the report may differ from the condition indicated by the comparable photos. Please review the photos and confirm that the reported condition rating is appropriate.",
  "The number of rooms shown in the property sketch differs from the rooms identified in the subject property photos. Please review the sketch and photos to confirm that the room counts are accurate.",
  "This is a new URAR 3.6 order and requires escalation to the Review Q.",
  "The sketch measurements do not match the Unit Interior Area Breakdown values. Please verify that Finished Above Grade, Finished Below Grade, and Unfinished Below Grade are consistent between the Unit Interior section and the Sketch Area Calculations Summary.",
  "One or more Unit Interior Area Breakdown values are missing from the Sales Comparison subject row. Please verify that Finished Above Grade, Finished Below Grade, and Unfinished Below Grade are consistent between the Unit Interior section and the Sales Comparison grid.",
  "The manufactured home HUD Data Plate is either not indicated as attached, or one or more HUD zone designations are missing. Please verify the Data Plate is attached and the Wind Zone, Thermal Zone, and Roof Load Zone are all reported",
  "One or more photos in the report appear to be blurry or out of focus. Please ensure all photos are clear and acceptable in quality.",
  "Verify that HOA dues in the Mandatory Fees section show a monthly frequency and a corresponding dollar amount.",
  "Foundation type and below-grade area appear inconsistent. Please verify that the Foundation Type and the Finished/Unfinished Below Grade area values correctly describe the property.",
  "The subject is a 2-4 unit manufactured home. Verify that the appraisal report includes a separate HUD Data Plate photo for each dwelling unit. The number of HUD Data Plate photos must match the number of units reported in the appraisal.",
  "A comparable shows a sales concession without an adjustment, or an adjustment without a concession. Verify the appraiser has explained why no adjustment was made.",
  "One or more rental comparable properties are missing an Interior Condition Rating. Verify the appraiser has provided a condition rating for all rental comparables in the Comparable Rental Analysis section.",
  "Report must include commentary as to why the subject's total bedroom count could not be bracketed in the sales grid analysis and whether there is any impact on the subject's marketability due to the uniqueness of the subject property.",
  "One or more photos may be placed outside their designated section in the UAD 3.6 URAR. Please confirm that all exterior, interior, street scene, vehicle storage, and amenity photos are placed under their correct sections as required by the UAD 3.6 spec.",
  "Review the Site Influence section to confirm that the listed site conditions and impacts are clearly explained and reasonable. Verify that any adverse, onsite or bordering, environmental, or multiple site influences are adequately supported by the commentary.",
  "Please verify the license details on the appraiser's certificate - the expiration date, license number, and state match the report",
  "One or more comparables have a gross adjustment exceeding [gross_adjustment_threshold]%. Please verify that supporting commentary has been provided to explain why this comparable is appropriate despite the large total adjustment.",
  "The lender's role must be identified as \"Client/Lender\" but only [value] has been reported.",
  "The following comparables have been adjusted for features that are the same as or substantially similar to the subject property. If an adjustment was warranted, please provide commentary explaining the basis for the adjustment. Comp #{}: {comp feature}",
  "Potential damage indicators were detected in the subject property photos. Please review the photos for possible safety, security, or structural condition issues.",
  "There is no photo of the Main Living Area or Living Room detected in the report. Please confirm the appraisal has included a photo of the main living area.",
  "The Cost Approach includes a site value estimate but no supporting commentary has been provided. Please verify that the report includes an explanation of how the site value was derived - whether by land sales, extraction, abstraction, or allocation method.",
  "Please verify the Income Approach is completed for this 2-4 unit property, or that the report includes commentary explaining why it was excluded.",
  "Some damage photos may be missing or don’t match the reported defects. Confirm that each defect in the report is supported by a labeled photo, and that all damage photos are mentioned in the report.",
  "A mismatch was detected between photos and captions. Please verify that all photos have appropriate captions and that all captions have a corresponding photo.",
  "Please verify the appraiser's license expiration date on the signature page, as it appears to be expired or missing as of the Date of Signature and Report.",
  "Known legal actions are indicated for this project but commentary is missing or contains only placeholder text. Please review and confirm adequate commentary has been provided explaining the nature of the legal action and its impact on value and marketability of the subject property.",
  "DYNAMIC: Content of the QC_Alert3 field",
  "Please ensure text and photos are free of political terms and signage.",
  "The subject quality rating in the report differs from the quality indicated by the subject photos. Please review the photos and verify that the reported quality rating is appropriate.",
  "The depreciation method is missing or a non-standard method (Other) has been selected. Verify the depreciation method is appropriate and supported by the analysis.",
  "One or more photos were detected without caption. Please review the photo exhibits and confirm that each photo includes a clear and appropriate label.",
  "The financing type for one or more comparables is reported as \"Other\" with a description that matches an option in the UAD dropdown. Please verify if a standard option should have been selected.",
  "The Active Listings price range and the Total Sales price range in the Market section do not overlap. This suggests the search criteria used for active listings and closed sales may be inconsistent. Verify both price ranges are sourced from the same market area and search parameters.",
  "Review the Site section to confirm that all parcels listed are properly reported and described. Verify that multiple parcels are acceptable as per Lender guidelines and supported in the report.",
  "Review the reported street type and surface and confirm whether the access is paved and typical for residential use, or if appraiser has provided supportings comments for unpaved or atypical access.",
  "The report indicates the subject has {value} levels in the unit. Confirm that the number of levels shown in the sketch and the Area Calculations Summary (including living and below-grade levels, if applicable) are consistent with the \"Levels in Unit\" field.",
  "An artist rendering or CGI image was detected in the subject exterior photos. Please confirm that a real photograph of the subject property is also included in the report.",
  "There is no photo of the laundry room detected in the report. Please confirm the appraisal includes a photo of the laundry room. If no photo is included, reference the sketch to determine if a laundry room appears to exist.",
  "One or more required utilities are missing from the Utilities section. Please confirm that Electricity, Gas, Sanitary Sewer, and Water are all reported.",
  "A structural defect is reported but the Market Value Condition is marked As Is. Please verify the appraisal condition is appropriate and supporting comments are provided for the structural issue.",
  "Please verify that the calculations breakdown is on the sketch",
  "Is there a person visible in the highlighted photo?",
  "There is no photo of the Kitchen detected in the report. Please confirm the appraisal has included a photo of the Kitchen.",
  "Please confirm the report includes a photo of the fireplace. If a fireplace is present on the property, a photo should be included in the Subject Property Amenities Exhibits section.",
  "Assignment type is \"Purchase\" but the report does not include a valid contract price.",
  "Confirm that the Effective Date of Appraisal matches the appraiser's inspection date and is not later than the Date of Signature and Report. Also verify that both Exterior and Interior inspections are marked as Physical.",
  "Confirm that the Effective Date of Appraisal matches the PDR inspection date and is not later than the Date of Signature and Report.",
  "The subject is a manufactured home. Please confirm that skirting is present and the skirting material is identified in the report.",
  "Please confirm that a HUD Certification Label photo is present for each section of the home. The number of HUD Certification Label photos must match the number of HUD Certification Label identifiers reported.",
  "The subject is an MH Advantage or CHOICEHome manufactured home. Please confirm that the certification photo is present for each program designation reported in the appraisal.",
  "Confirm that the Effective Date of Appraisal is populated and is not later than the Date of Signature and Report for the Desktop appraisal.",
  "In order to comply with ANSI, the sketch should include readable labels and/or area calculations that support the reported finished and/or unfinished below grade areas of the basement.",
  "Please verify whether the contract date is missing or after the effective date, and confirm if an adjustment or explanation should be provided.",
  "One or more comps has been duplicated in the sales comparison grid. Review and request correction as needed.",
  "The sketch dimensions and labels must be readable. Please check if the sketch dimensions and labels are readable.",
  "A religious object was detected. Is there a religious object in the highlighted subject photo?",
  "There are some inconsistencies between the Room Summary, Sketch, and Photo labels. Please check that the room counts match and all rooms are labeled the same in each section.",
  "DYNAMIC - Content of the QC_Alert1 field",
  "The subject's sales or listing history appears incomplete or inconsistent. Verify the 12-month listing and 3-year sales history are accurately reported.",
  "Check that the Subject and all Comparables have a reported monthly association fee. If the fee is missing for the Subject or any Comparable and not recorded as $0, verify whether the appraiser provided a supporting comment.",
  "The following appraisal XML data points are improperly formatted. If you are unable to resolve this by updating your entries into these fields within your appraisal software, please contact your software provider about this issue. - Car Storage Detail / Parking Spaces Count : Expected Integer, found \"invalid string\"",
  "The site influence type is reported as \"Other\" with a description that appears to match an available enumeration in the UAD Reference Guide. Please verify whether a valid enumeration should have been selected instead of \"Other.\"",
  "Adjustment field within the Sales Comparison Approach grid must contain \"$0\" if no adjustment is made.",
  "The site influence type for one or more comparables is reported as \"Other\" with a description that appears to match an available enumeration in the UAD Reference Guide. Please verify whether a valid enumeration should have been selected.",
  "Foundation type and below-grade area appear inconsistent. Please verify that the Foundation Type and the Finished/Unfinished Below Grade area values correctly describe the property.",
  "The Reconciliation of Sales Comparison Approach commentary does not align with the Comparable Weight values assigned in the sales grid. Please verify that the reconciliation explains the weight given to each comparable (Most, Same, or Less) and that the explanation is consistent with the grid values.",
  "The Value Indicated by Cost Approach differs from the Opinion of Market Value by more than [cost_approach_variance_threshold]%. Verify the appraiser has provided commentary explaining the variance between the two values.",
  "Subject property has non-residential use indicated. Verify this designation is correct and supporting description/comments is provided.",
  "Adverse site conditions have been indicated. Verify the appraiser has provided adequate commentary addressing the condition and any impact on value or marketability.",
  "Check for missing or unmatched exterior damage photos. Confirm that each reported exterior defect has a corresponding labeled photo, and that all exterior damage photos are referenced in the report.",
  "One or more required exterior photos are either missing or not clearly labeled. If the photo exists in the report but this rule still fired, it was uploaded under the wrong category (e.g. as an Assignment Exhibit instead of Dwelling Rear). Please ensure all required views are present and properly labeled.",
  "Please confirm whether the Construction Method is either missing or listed using a term that isn’t among the accepted values for the subject’s property type.",
  "Property has Green Energy Efficiency rating information. Verify all rating fields are complete and accurate: organization name, rating type, and numeric score value match any supporting documentation.",
  "Please confirm the appraisal includes the subject property sketch and that it is properly attached.",
  "Confirm that the Effective Date of Appraisal matches the appraiser's inspection date and is not later than the Date of Signature and Report. Also verify that both Exterior and Interior inspections are marked as Physical.",
  "Confirm that the Effective Date of Appraisal matches the PDR inspection date and is not later than the Date of Signature and Report.",
  "Confirm that the Effective Date of Appraisal is populated and is not later than the Date of Signature and Report for the Desktop appraisal.",
  "Accessory Unit Exists has been selected. Confirm the subject's Accessory Unit has been included in the sketch.",
  "The Total Monthly Market Rent reported in the Rent Schedule ([Rent Schedule Total]) does not match the value reported in the Income Analysis section ([Income Analysis Total]).",
  "The opinion of market value differs notably from the contract price, but the report lacks supporting comments. Please confirm if explanatory comments has been provided in the report.",
  "The report indicates a “Subject to” condition, but supporting details such as itemized repair, inspections, completion actions along with associated cost estimate details are missing.",
  "Borrower and seller appear to be the same in a purchase transaction, which may indicate a data entry issue or an incorrect assignment reason.",
  "Verify that the borrower name in the appraisal exactly matches the order details.",
  "Verify that the borrower name in the appraisal exactly matches the current owner of public record.",
  "The valuation method is listed as \"PropertyValuationMethodType\", but the report indicates that a Property Data Report used in lieu of inspection is marked as \"PropertyDataReportIndicator\".",
  "A physical inspection was indicated, but the inspection date is missing from the report.",
  "Expiration Date of License is prior to the date of inspection.",
  "This report contains appraiser identity details that do not match the order details.",
  "Please ensure the Borrower name in the report reflects an individual and is not a business entity.",
  "The appraisal report indicates significant assistance was provided, but the contributor’s name or the description of their role is missing or incomplete.",
  "Building certification is indicated for subject property. Verify all certification details are complete and accurate: organization name, certification type, year awarded, version, and rating level match any supporting documentation.",
  "Property has {Component} - {Ownership} renewable energy. Verify description addresses - (1) lease/ownership status, (2) component not part of real property, (3) transferability when sold, (4) impact on value/marketability. Confirm all required elements are adequately documented.",
  "The following comparable(s) do not match the stated Search Criteria Description (List comp#n and which fields are outside range).",
  "Median Sale Price ($[MedianSalePrice]) is outside the reported range $[LowestSalePrice]–$[HighestSalePrice]. Please verify the Market section - Sales in Past $[SalesMonths] Months.",
  "A potential discrepancy was detected between the photo and its label. Please verify that the label accurately matches the content shown in the image.",
  "Passing Message - Reported Overall Condition Rating =\"C6\" - Supporting photos are included and visually consistent with the rating. - Supporting commentary is provided and explains the condition in line with the assigned rating. Failing Rule QC Review & Revision Request Message - Reviewer Instruction - Overall Condition Rating = \"C6\", but required supporting photos and/or commentary are missing or inconsistent with the rating. N/A Rule Message - This is either not an interior appraisal, or the appraiser did not include an overall Quality rating.",
  "The appraiser's Overall Quality rating does not match the quality level detected by RestB photo analysis. Please review the subject property photos and verify the quality rating is appropriate.",
  "The appraised property type does not match what was ordered.",
  "The report shows the value is conditional, but no repairs or justification is provided for the poor condition rating.",
  "The subject and comparable condition ratings differ, but no adjustment or supporting comment is provided. Please verify if an explanation or condition adjustment is required.",
  "Opinion of Market Value' does not match the 'Indicated Value' by Sales Comparison Approach.",
  "The contract price is higher than the appraised value and is supported by the adjusted sale prices of comparable settled sales. Please verify whether the appraiser has provided adequate comments to justify this variance.",
  "The appraised value or contract price exceeds the property's list price. Please verify whether the appraiser has provided adequate comments.",
  "The Effective Date of Appraisal is earlier than the reported inspection date.",
  "A potential discrepancy was detected between the photo content and its label. Please verify that the photo label accurately reflects what is shown in the image.",
  "Solar panels appear to be present in the subject photos. Please confirm the report properly discloses the solar/renewable energy feature (and ownership/details if applicable) in the Energy Efficient & Green Features or Improvements sections.",
  "The subject’s View | Range differs from the selected comparables ({subject_view}/{subject_range} vs. {comp_views}). If no adjustment is provided, confirm that the report includes a clear market-based explanation supporting no adjustment.",
  "Subject site influence does not match the comparable’s site influence, and no adjustment is shown. Please verify the appraiser provided a comment explaining why no adjustment is needed",
  "Subject topography (subject_topography) does not match comps #n topography. confirm that the appraiser has either - applied an appropriate topography adjustment, or provided explanatory comments why no adjustment was made.",
  "Check if the Year Built difference between the subject and comparables is greater than the allowed threshold. If so, confirm that the appraiser has either applied an adjustment or provided comments to explain why no adjustment is needed.",
  "The subject and comp have different Site Characteristics. Check if the appraiser provided comments on the difference or gave an adjustment.",
  "Verify that the Corner Unit field is completed when available. If the subject is a corner unit and comps are not, ensure an adjustment or a supporting comment is provided.",
  "The subject and comparable(s) differ in disaster-mitigation features (e.g., impact-resistant glass/shingles). Ensure the appraiser has either applied a market-supported adjustment or provided comments explaining why no adjustment is required.",
  "Please verify whether the Listing Price has been provided for the subject and/or comparable properties, where applicable.",
  "If the subject and comp heating systems differ, confirm that the appraiser has either applied an adjustment or added comments to support no adjustment.",
  "Passing Message -Reviewers Instruction - The proximity of the comparable sale is appropriate based on its distance and the subject's lot size. No further justification is required. Reviewer Instruction-Failing Rule QC Review & Revision Request Message Comparable \"comp\" proximity to Subject exceeds standard proximity threshold, based on the subject's lot size additional comments are required to justify the use of this comp. N/A Rule Message - This rule was not applied because either the proximity or the subject lot size is missing.",
  "The difference in finished below grade area between the subject and the comparable above acceptable range, check if adjustment or supporting comment has been provided by the appraiser.",
  "If the subject and comp Structure Designs do not match, check that the appraiser provided either an adjustment or supporting comments. If not, mark as fail.",
  "Subject and Comparable(s) have different Construction Methods, confirm that the appraiser has provided either an appropriate adjustment or comments explaining the difference.",
  "The comparable is marked as “Settled Sale,” but the Sale Price is missing or $0. Please check if this is an error or if the comp is actually still \"Active\" or \"Pending\".",
  "Please check whether the subject and comparable water features differ. If they do, confirm that an adjustment or a clear explanatory comment is provided.",
  "The Subject and one or more Comparable(s) show differences in Noncontinuous Finished Area; verify that an adjustment or supporting comment has been provided.",
  "Please verify that the Special Assessments field for the subject and all comparable properties is completed and indicates either ‘Existing,’ ‘Proposed,’ or ‘None.’",
  "Check if the subject has any unique interior features (e.g., media room, wet bar) not found in the comparables. If they differ, confirm that an adjustment or explanation is provided.",
  "Subject listing status is \"Pending\" but fewer than 3 closed comparables are provided, confirm that the appraiser has included supporting comments.",
  "The difference in unfinished area below grade between the subject and the comparable exceeds acceptable limits. Please verify if the appraiser has applied a suitable adjustment or included a supporting comment.",
  "Check if the number of full and half baths for each unit in the 2–4 unit subject matches with its corresponding units in all comparables. If it differs confirm that either an adjustment or a supporting comment is provided.",
  "The subject and comparable property restrictions does not match. No adjustment is applied. Please review the report and confirm whether the appraiser provided adequate explanation.",
  "Review the finished below grade area of the ADU for the subject and comparables. If the values differ, ensure the appraiser has applied an adjustment or provided a comment explaining why an adjustment is not needed.",
  "Please review the Finished Area Above Grade for each unit in the subject and comparable properties. If there's a noticeable difference, ensure that an adjustment is applied or a comment is provided to explain why an adjustment is not necessary.",
  "The subject property includes an ADU. Compare the number of bedrooms in the subject’s ADU with each comparable’s ADU. If the bedroom counts differ, confirm that the appraiser has either applied an adjustment or provided a comment explaining why no adjustment is needed.",
  "Check if the full and half bath counts for the subject and all comparables are provided. If there’s a difference, confirm that adjustment or a supporting comment is present.",
  "Comp #n property rights appraised differ from the subject’s property rights. Required adjustment or explanatory comment is missing.",
  "The subject and comparable(s) show different building certifications. Please verify that certifications are either reported consistently across the subject and comparables or that differences are supported with an adjustment or comments.",
  "Verify that the \"Levels in Unit\" is field has value when available. If the subject and comps differ, check for an adjustment or a supporting comment.",
  "If \"Same Project as Subject\" = No, ensure that either a non-zero $ adjustment is provided in the Project Information section or there is a supporting comment explaining why no adjustment was made.",
  "The subject property was built before 1978, confirm that the report addresses peeling/flaking/chipping paint. If present, ensure there are photos, commentary, and cost-to-cure provided. If explicitly stated as not observed, verify that the negation is clear. Suggested keywords: ‘peeling’, ‘flaking’, ‘chipping’, ‘paint’",
  "Verify that if the comp differs from the subject, either a non-zero adjustment is applied in the grid or the appraiser has provided supporting commentary explaining why no adjustment is required.",
  "Outdoor Living features differ between Subject and Comparable, but no adjustment or comments are provided.",
  "If the subject and comp cooling systems do not match, confirm that the appraiser either applied an adjustment or provided comments explaining why no adjustment is needed.",
  "The subject and comparable zoning compliance differ, and the report does not include either an adjustment or adequate supporting comments.",
  "The comparable’s neighborhood differs from the subject, but no adjustment or supporting commentary was provided.",
  "The subject list price ($[ListPrice]) is outside the closed sales range $[LowestClosedSalePrice]–$[HighestClosedSalePrice]. Verify if the appraiser provided supporting comments.",
  "Check if the Finished Area Above Grade (GLA) for the subject and each comparable is within 15%. If the difference exceeds 15%, verify that an appropriate adjustment is applied or a comment is provided explaining why no adjustment is needed.",
  "Confirm that the Floor Number is entered for condos or co-ops in multi-story buildings. If a comparable is missing a Floor Number, ensure a supporting adjustment and comment are provided.",
  "The subject and comparable(s) project name must align with the “Same Project as Subject” indicator (Yes/No). Please verify consistency.",
  "Subject Hazard Zone and Comparable Hazard Zone does not match, but no adjustment or explanatory commentary is provided",
  "If the subject property includes an ADU, compare its Finished Area Above Grade with each comp's ADU. If the difference is greater than 15%, confirm whether an adjustment is applied or a comment is provided explaining why no adjustment is necessary.",
  "Subject is a manufactured home, at least two comparable sales must also be manufactured homes with a consistent width type (e.g., double-wide, multi-wide).",
  "The subject or one or more comparables shows a different Efficiency Rating. Check if appropriate adjustment is applied or appraiser provided supporting comment.",
  "Please review the Outbuilding Unfinished Area for the subject and comparable. The subject has unfinished outbuilding space, and the comparable differs in area. Ensure that a proper adjustment or specific comment is provided if there is a material difference.",
  "Comp #n’s site size differs from the subject by more than 25%. A site adjustment is not made, please check if the appraiser provided explanatory comments.",
  "If the Subject property is a Manufactured Home and its width type (e.g., Single-wide, Double-wide, Multi-section) differs from one or more Comparable Manufactured Homes, confirm that the appraiser has either provided an appropriate adjustment or supporting commentary explaining the difference.",
  "The subject and comp's Back-to-Back unit status differ, confirm that the appraiser has provided either an adjustment or supporting comments.",
  "If the subject and comp differs in End Unit status, check that the appraiser provided either an adjustment or supporting comments.",
  "The subject and comp have the same outbuilding type but different reported utility availability (e.g., electricity vs. none). Verify whether an adjustment is applied or if the appraiser has provided an appropriate explanation for the utility difference.",
  "The subject and comp have the same outbuilding type, but different heating types. Confirm if the appraiser has provided a supporting comment or applied an adjustment for this difference.",
  "Please review the basement access differences. If the subject has walk-out access and the comp has no access or walk-up, ensure a positive adjustment or clear comment is included.",
  "Please verify that all comparable properties have amenities and services consistent with the subject, or that an appropriate adjustment or explanatory comment has been provided.",
  "Check if an ADU is present. If yes, ensure the ADU location field is filled. If no ADU exists, the location field and related values should be left blank or zero.",
  "Subject and Comparable townhouse locations differs, check that the appraiser provided either an adjustment or supporting comments.",
  "If the subject and comp Dwelling Styles differ, confirm that the appraiser has either applied an adjustment or provided supporting comments.",
  "Check if the bedroom count for the subject and each comparable unit s provided. If bedroom counts differ for any matching unit, confirm that an appropriate adjustment is applied or a supporting comment is present. Ignore units that exist only in the subject or only in the comparable.",
  "The subject property includes an ADU. Compare the ADU's full and half bath counts with each comparable’s ADU. If the counts differ, ensure there is either an adjustment or a comment explaining the difference.",
  "Gross Building Finished Area differs between subject and comparable. Ensure appraiser has applied adjustment or provided supportings comments.",
  "Check that the appraisal includes at least one closed comparable sale from within the subject’s project and at least one closed comparable sale from outside the project. If not, check whether the appraiser provided supporting comments.",
  "The subject or comparable(s) has a different Renewable Energy Component, verify that an adjustment was made or a supporting comment was provided.",
  "Contract price or date doesn’t match the value in order details.",
  "The contract price reported in the appraisal does not match the sale price provided in the order details.",
  "Appraiser signature and/or license details are missing or do not match the appraiser name listed in the report.",
  "This property has agricultural zoning. Please verify the appraisal contains appropriate commentary about whether any commercial farming activities were observed on the property.",
  "The Opinion of Market Income Total ([Total]) does not equal the sum of the Rent Subtotal ([Rent]) and Other Real Property Rental Income ([Other]).",
  "Zoning compliance reported as Illegal. Please ensure whether 'Illegal' zoning designation is typical for the market area and supporting comments are provided.",
  "The subject property has water frontage with private access. Please review the Water Frontage section to confirm the frontage type, water name, access rights, access depth, and any permanent features (such as a dock or pier) are complete and reasonable.",
  "The property is marked as New Construction, confirm that a plat map or property boundaries exhibit is included in the report.",
  "Review the Site section to verify the property’s primary access and check whether the appraiser has commented on the non-public or atypical access.",
  "One or more utilities are marked as both Public and Private. Please review the Utilities section and confirm the correct utility source, updating the selection if needed for clarity and accuracy.",
  "Review the Hazard Zone section to confirm that the reported hazard (if any) is clearly identified, supported by impact selection, and explained in the commentary. If \"No Hazard Zone Noted\" is selected, confirm it is consistent with the rest of the report.",
  "Review the 'View and Impact to Value/Marketability' section to confirm the view details and commentary adequately explain the reported impact.",
  "Total Site Size does not match the sum of Parcel Sizes, or units do not match. Please verify all site measurements and units are accurate. Difference: {calculated difference}.",
  "Review the Utilities section to confirm public and private utility selections are accurate. If any utility is private, verify the impact is marked Neutral and supported by clear commentary.",
  "If site area exceeds 15 acres, verify that the appraiser has provided market-supported comments for opinion of site value.",
  "Broadband is marked as 'No'. Confirm the report includes a brief explanation such as - satellite-only service or broadband not available in the area",
  "The report indicates leasehold ownership, but required lease terms or expiration date are missing from both the fields and comments.",
  "Property is marked as \"ProjectLegalStructureType\", but ‘Subject Site Owned in Common’ is unchecked or blank. Confirm ownership structure.",
  "A defect is reported in the Dwelling Exterior section. Please confirm that the Structural Integrity selection, Recommended Action, and Condition Rating are consistent and that repair status is clearly stated.",
  "Subject is a multi-unit property. Confirm that the number of levels reported for each unit matches the levels shown in that unit's sketch and the corresponding Area Calculations Summary.",
  "The subject value opinion is not bracketed by the unadjusted comp sale price range. Please verify that the report includes commentary explaining why the comparable sales are appropriate despite the significant price differences and how the adjustments support the final value opinion.",
  "Cost Type requires verification. Either \"Reproduction\" was selected for a non-Manufactured Home property, or the Cost Type is missing. Verify the appropriate method is selected for this property in the Cost Approach section.",
  "Please check if the report includes commentary explaining why the subject's total bathroom count could not be bracketed in the sales grid analysis and whether there is any impact on marketability due to the uniqueness of the subject property.",
  "The AMC License/Registration Number and/or License Issuing State are missing in the report. Verify the appraiser has populated both the License Identifier AND the License Issuing State within the AMC's PARTY block in the Assignment Information section.",
  "Distressed Market Competition is Yes but Demand/Supply is Shortage - these are inconsistent. Verify and correct the Demand/Supply field.",
  "Please include all required report sections based on the property type, occupancy, and inspection type, or explain why any are missing.",
  "One or more adjustments in the Sales Comparison Grid appear to be applied in the wrong direction. Review the flagged comparable(s) and feature(s) and confirm the adjustment direction is consistent with the subject-to-comparable feature difference.",
  "Zoning has been flagged as illegal. Verify zoning classification and determine if the property is eligible for the intended use.",
  "The report does not appear to include a disclosure of the appraiser's fee. Please ensure the appraiser has included their fee within the body of the report.",
  "One or more subject utilities are not public. Verify the appraiser has commented on any potential impact to marketability.",
  "The following appraisal XML data points are improperly formatted. If you are unable to resolve this by updating your entries into these fields within your appraisal software, please contact your software provider about this issue. The report cannot be submitted until these errors are resolved.",
  "DYNAMIC - Content of the QC_Alert2 field",
  "The subject's sales or listing history appears incomplete or inconsistent. Verify the 12-month listing and 3-year sales history are accurately reported.",
  "The subject's sales price falls outside the reported market inventory price range. Verify the neighborhood market analysis and price range are accurate.",
  "Adverse site conditions have been indicated. Verify the appraiser has provided adequate commentary addressing the condition and any impact on value or marketability.",
  "Co-op project interest or development data appears incomplete or inconsistent. Verify the cooperative project information including shares, proprietary lease, and blanket financing details.",
  "The Property Valuation Type is Traditional or Exterior, and the Inspection Date does not equal the Effective Date.",
  "Co-op project interest or development data appears incomplete or inconsistent. Verify the cooperative project information including shares, proprietary lease, and blanket financing details.",
  "Converted areas are indicated in the appraisal. Verify the appraiser has addressed whether the converted areas are of consistent quality with the original construction.",
  "Verify that any special instructions, private instructions, or investor-specific requirements have been followed in the appraisal report.",
  "The subject value opinion is not bracketed by the adjusted comp price range. Please confirm the report includes commentary reconciling why the final value falls outside the range of adjusted comparable sale prices.",
  "The supervisory appraiser on this report holds a Licensed Residential Appraiser credential. A supervisory appraiser must hold a Certified Residential or Certified General license per USPAP requirements. Verify the supervisory appraiser's license type and confirm eligibility to sign as supervisory appraiser for this report.",
  "The Supply/Demand trend and Marketing Time in the Housing Trends section are inconsistent. Please verify both fields accurately reflect current market conditions and are supported by the market data provided.",
  "Per the UAD 3.6 formatting requirements, all photos included in the folder must be referenced in the associated xml. Please reach out to the appraisal software provider to resolve this issue.",
  "The report file size exceeds the allowable limit of 60 MB. Please ensure all files are compressed before submission.",
  "The subject's Gross Rent Multiplier ([GRM]) falls outside the range of the GRM comparables ([min]-[max]). Verify the appraiser has provided commentary explaining why the subject GRM is not bracketed by the comparable GRMs, or confirm whether the GRM should be revised.",
  "The transfer terms for one or more comparables is reported as \"Other\" with a description that matches an option in the UAD dropdown. Please verify if a standard option should have been selected.",
  "Market Value is marked as conditional, but supporting defect or repair cost data is missing.",
  "The Actual Income Total ([Total]) does not equal the sum of Rent Subtotal ([Rent]) and Other Real Property Rental Income ([Other]).",
  "The subject was listed within the previous year. Review the listing history analysis for adequacy — verify it addresses the listing circumstances, market exposure (days on market), list price relative to contract price, and any atypical terms or conditions.",
  "The Marketing Time reported in the Housing Trends section does not align with the Median Days on Market in the Search Result Metrics. Verify both fields are accurately reported and consistent with each other",
  "Subject is a Manufactured Home but the Cost Approach is not completed. Verify the appraiser has completed the cost approach section",
  "The supervisory appraiser's license expired before the date of signature and report, or the license expiration date or signature date could not be confirmed. Verify the supervisory appraiser's credentials and confirm whether the license was valid at the time of signing.",
  "The subject property is identified as new construction but the Cost Approach has not been completed. The Cost Approach is required for all new construction appraisals. Please complete the Cost Approach section.",
  "The subject's Finished Area Above Grade falls outside the comparable sales range. Verify the appraiser has provided commentary explaining why more similar comparables weren't used and whether this affects the subject's marketability.",
  "The report does not appear to include a disclosure of the appraiser's fee. Please ensure the appraiser has included their fee within the body of the report.",
  "Converted areas are indicated in the appraisal. Verify the appraiser has addressed whether the converted areas are of consistent quality with the original construction.",
  "The subject has a prior sale or transfer within the 3-year lookback period. Review the appraiser's analysis for adequacy — verify it addresses the circumstances of the prior transfer, any significant price change relative to the current appraised value, and consistency with the value conclusion.",
  "The subject's sales price falls outside the reported market inventory price range. Verify the neighborhood market analysis and price range are accurate.",
  "The subject property has a prior sale or transfer within the 3-year lookback period but no analysis has been provided.",
  "One or more rental comparable properties are missing a data source. Verify the appraiser has identified the data source for each rental comparable in the Comparable Rental Properties section.",
  "The subject property is subject to rent control, but none of the rental comparable properties are also subject to rent control. Verify the report includes commentary explaining why no rent-controlled comparables were used and addressing the impact on the Opinion of Market Rent.",
  "Rental comparable(s) [Comp #] are located [X] miles from the subject property, exceeding the [max_rental_comp_distance_miles]-mile threshold. Verify the appraiser has provided commentary supporting the use of comparables outside the typical distance range.",
  "The subject's Opinion of Market Rent per unit ([X]) falls outside the range of the rental comparable Adjusted Rents ([min]-[max]). Verify the appraiser has provided commentary explaining why the subject market rent is not bracketed by the comparable adjusted rents.",
  "The Rent Schedule shows a mix of owner-occupied and tenant-occupied units. Verify the occupancy type for each unit is correctly reported and the report reflects the mixed occupancy appropriately.",
  "The Total Actual Monthly Rent ([Actual]) exceeds the Opinion of Total Gross Monthly Rent ([Market]). Verify the report includes commentary explaining why the Opinion of Market Rent is lower than the actual rent being collected.",
  "The Indicated Value by Income Approach ([Value]) does not equal Gross Rent Multiplier ([GRM]) × Total Monthly Market Rent ([Rent]).",
  "The Cost Data Source Effective Date is older than [cost_data_max_months] months. Verify the appraiser has addressed the use of older cost data in their commentary, or confirm whether more current cost data should be referenced.",
  "The estimated remaining economic life of the property improvements is less than [remaining_economic_life_min_years] years. Review and verify this is accurate and supported by the condition and age of the improvements.",
  "Verify the Opinion of Site Value. Either the Cost Approach is incomplete or the Site Value exceeds 30% of the Indicated Value by Cost Approach.",
  "The subject's Finished Area Above Grade for one or more units falls outside the comparable sales range for the corresponding unit. Verify the appraiser has provided commentary explaining the bracketing miss and whether this affects the subject's marketability.",
  "A project deficiency has been indicated but the commentary is missing, contains only placeholder text, or is too brief to be meaningful. Please verify the appraiser has provided a substantive description of the deficiency and its impact on value or marketability.",
  "The units rented count is reported as an estimate but the required description explaining why an exact count could not be obtained is missing, contains only placeholder text, or is too brief. Please verify the appraiser has provided a substantive explanation.",
  "A unit special assessment is indicated as 'Existing' or 'Proposed' but the required commentary is missing. Please verify the appraiser has provided a substantive explanation of the assessment and its impact on value or marketability.",
  "The subject's Indicated Value ($[X]) divided by [units] units divided by [beds] bedrooms per unit equals $[per_bedroom_value] per bedroom, which falls outside the comparable sales Adjusted Price Per Bedroom range ($[min]-$[max]). Verify the appraiser has provided commentary explaining why the subject's per-bedroom value could not be bracketed by the comparable sales.",
  "The subject's Indicated Value ([X]) divided by the number of units ([units]) equals $[per_unit_value] per unit, which falls outside the comparable sales Adjusted Price Per Unit range ([min]-[max]). Verify the appraiser has provided commentary explaining why the subject's per-unit value could not be bracketed.",
  "The Project Information Commentary is missing or contains only placeholder text. Verify the appraiser has provided a meaningful overall summary of the project and its impact on value and marketability.",
  "The Project Factors Commentary is missing or contains only placeholder text. Verify the appraiser has provided a meaningful summary explaining the project factors and their impact on value and marketability.",
  "Unit tax abatements or exemptions are indicated for this project but commentary is missing, contains only placeholder text, or the impact is reported as Adverse. Verify the appraiser has provided adequate commentary explaining the tax abatement program, amount, expiration date, and its impact on value and marketability.",
  "A unit transfer fee is indicated for this project but commentary is missing, contains only placeholder text, or the impact is reported as Adverse. Verify the appraiser has provided adequate commentary explaining the transfer fee amount, terms, and its impact on value and marketability.",
  "The project is subject to ground rent but the annual amount, expiration date, or description is missing. Verify all ground rent details are accurately reported in the Project Information section.",
  "The percentage of commercial space in this project ([X]%) exceeds the maximum threshold ([commercial_space_max_pct]%). Verify the commercial space percentage is accurately reported.",
  "Fewer than [min_comps_with_same_unit_count] comparable sales have the same unit count as the subject property. Please verify the appraiser has provided adequate commentary with documentation of market support for the unit count differences.",
  "Single Family Comparable Detected. Comparable(s) [Comp #] have fewer than 2 units. On a 2-4 unit appraisal, all comparable sales should be multi-unit properties.",
  "The subject's Opinion of Market Rent per unit ([X]) exceeds the maximum rent of the rental comparable properties ([max]). Review the report for commentary explaining why the subject rent could not be bracketed by the rental comparables.",
  "Comparable(s) [Comp #] have more units than the subject property ([X] units). Review for possible dissimilarities in marketability and comparability of rents.",
  "Proprietary lease expiration date is missing or the remaining lease term may be below the minimum threshold. Please verify the date is accurate and the remaining term meets GSE eligibility requirements.",
  "The subject's Gross Building Finished Area falls outside the comparable sales range. Verify the appraiser has provided commentary explaining why more similar comparables weren't used and whether this affects the subject's marketability.",
  "One or more comparables have a net adjustment exceeding [net_adjustment_threshold]%. Please verify that supporting commentary has been provided to address the large net adjustment.",
  "One or more comparable sales are older than [comparable_sale_age_limit_months] months. Please verify that a time adjustment or supporting commentary has been provided to justify the use of this comparable.",
  "A single entity owns [X]% of the units/shares in this project, which exceeds the maximum threshold of [single_entity_max_pct]%. Verify the ownership concentration is accurately reported and confirm the project meets GSE eligibility requirements.",
  "A UAD 3.6 hard stop error has been detected.",
  "The Rental Analysis Commentary is missing, blank, or does not appear to address the rental comparable selection or support the Opinion of Market Rent. Verify the appraiser has provided meaningful commentary explaining the basis for the rental analysis.",
  "The report does not appear to include a disclosure of the AMC fee. Please ensure the AMC fee has been disclosed in the report.",
  "The subject is a manufactured home. The towing hitch, wheels, and axles must be removed from the frame as a condition of financing eligibility. Please confirm this is accurately indicated in the appraisal report.",
  "The subject is a manufactured home with a modification, attachment, or addition indicated. The supporting commentary is missing or contains only placeholder text. Please verify the appraiser has described the modification and addressed its impact on value and marketability.",
  "The subject is a manufactured home and one or more invoice fields indicate a concern. Please verify the home was purchased from a retailer, the retailer's invoice has been reviewed, the manufacturer's invoice has been reviewed, and the invoice content appears reasonable.",
  "Verify that any special instructions, private instructions, or investor-specific requirements have been followed in the appraisal report.",
  "PUD classification appears inconsistent with HOA or project data. Verify the property's PUD status and HOA fee reporting.",
  "The property has more than 3 ADUs reported. Verify the ADU count and confirm whether the property is eligible under Fannie Mae guidelines. A maximum of 3 ADUs are permitted on a single-unit property.",
  "Please confirm the update status for kitchens, bathrooms, and flooring reflects the new construction condition of the property - all should be reported as \"Fully Updated.\"",
  "The appraiser reported multiple units or an ADU for the subject property, but did not provide a detailed unit layout or supporting sketch.",
  "Attachment Type field is missing based on the property's construction method and ownership type. Required for site-built or manufactured properties unless the property is a condo, co-op, or condop.",
  "A busy road was detected within close proximity of the subject property and/or one or more comparables. Please review and confirm that all external influences have been appropriately addressed with commentary and/or adjustments, if warranted.",
  "The total of dwelling units plus ADUs exceeds the allowable limit of 4 for a 2-3 unit property. Verify the unit and ADU counts and confirm whether the property is eligible under Fannie Mae guidelines.",
  "Unit count may include an ADU or is inconsistent with property type. Verify legal unit count, ADU presence, and that ADUs are excluded from ‘Units Excluding ADUs’.",
  "PUD isn’t selected on the form, but HOA fees and shared amenities are reported - verify whether the subject is in a PUD"
];

function getCategory(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("manufactured") || t.includes("hud")) return "Manufactured Home";
  if (t.includes("adu")) return "ADU";
  if (t.includes("comparable") || t.includes("comp #") || t.includes("comps") || t.includes("grid") || t.includes("sales comparison")) return "Sales Comparison";
  if (t.includes("site") || t.includes("zoning") || t.includes("parcel") || t.includes("boundary") || t.includes("topography") || t.includes("easement") || t.includes("frontage") || t.includes("waterfront")) return "Site";
  if (t.includes("neighborhood") || t.includes("hoa") || t.includes("fees") || t.includes("subdivision") || t.includes("project")) return "Neighborhood/Project";
  if (t.includes("utilities") || t.includes("electricity") || t.includes("water") || t.includes("gas") || t.includes("sewer") || t.includes("broadband")) return "Utilities";
  if (t.includes("heating") || t.includes("cooling") || t.includes("fireplace") || t.includes("mechanical") || t.includes("laundry")) return "Improvements/Mechanical";
  if (t.includes("quality") || t.includes("condition") || t.includes("defect") || t.includes("damage") || t.includes("blurry") || t.includes("sketch") || t.includes("ansi") || t.includes("measurements") || t.includes("rooms")) return "Improvements/Condition";
  if (t.includes("appraiser") || t.includes("license") || t.includes("signature") || t.includes("amc") || t.includes("supervisory") || t.includes("date")) return "Appraiser/Certifications";
  if (t.includes("contract") || t.includes("price") || t.includes("borrower") || t.includes("purchase") || t.includes("seller")) return "Contract/Assignment";
  if (t.includes("cost approach") || t.includes("site value") || t.includes("depreciation")) return "Cost Approach";
  if (t.includes("income approach") || t.includes("rent") || t.includes("grm") || t.includes("tenant")) return "Income Approach";
  if (t.includes("photo") || t.includes("image") || t.includes("caption") || t.includes("label")) return "Exhibits/Photos";
  return "Supplemental Guidelines";
}

function getSeverity(text: string): "HardStop" | "Warning" | "Advisory" {
  const t = text.toLowerCase();
  if (t.includes("hard stop") || t.includes("hardstop") || t.includes("must") || t.includes("required") || t.includes("illegal") || t.includes("not match") || t.includes("differ") || t.includes("mismatch") || t.includes("exceeds")) {
    return "HardStop";
  }
  if (t.includes("advisory") || t.includes("suggest") || t.includes("suggestion") || t.includes("optional")) {
    return "Advisory";
  }
  return "Warning";
}

interface Rule {
  rule_id: string;
  category: string;
  description: string;
  severity: "HardStop" | "Warning" | "Advisory";
  enabled: boolean;
  logic: { type: string; [key: string]: any };
  citation: string | null;
  messages: { appraiser?: string | null; reviewer?: string | null };
  h1?: any;
  updated_at?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const rulesPath = path.join(DATA_DIR, "rules.json");

function loadExistingRules(): Rule[] {
  if (fs.existsSync(rulesPath)) {
    try {
      return JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
    } catch (e) {
      console.error("Error reading existing rules.json:", e);
    }
  }
  return [];
}

function saveRules(rules: Rule[]) {
  // Archive old file if exists
  if (fs.existsSync(rulesPath)) {
    const archivesDir = path.join(DATA_DIR, "archives");
    if (!fs.existsSync(archivesDir)) {
      fs.mkdirSync(archivesDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
    const archivePath = path.join(archivesDir, `rules_pre_import_${timestamp}.json`);
    fs.copyFileSync(rulesPath, archivePath);
    console.log(`[Backup] Archived existing rules database to ${archivePath}`);
  }

  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2), "utf-8");
  console.log(`Saved ${rules.length} rules to rules.json successfully.`);
}

function runImport() {
  console.log("Starting batch rule import...");
  const existingRules = loadExistingRules();
  console.log(`Loaded ${existingRules.length} existing rules.`);

  const existingIds = new Set(existingRules.map(r => r.rule_id));
  const newRules: Rule[] = [];
  let skippedCount = 0;
  let addedCount = 0;

  RAW_RULES.forEach((rawText, index) => {
    const cleanText = rawText.trim();
    if (!cleanText) return;

    // Generate stable unique rule_id based on index, e.g., QC_SUPP_101
    const rule_id = `QC_SUPP_${String(101 + index).padStart(3, "0")}`;

    // Check if this text or ID already exists in our database
    const textDuplicate = existingRules.find(r => r.description.toLowerCase() === cleanText.toLowerCase());
    if (textDuplicate || existingIds.has(rule_id)) {
      skippedCount++;
      return;
    }

    const category = getCategory(cleanText);
    const severity = getSeverity(cleanText);

    const rule: Rule = {
      rule_id,
      category,
      description: cleanText,
      severity,
      enabled: true,
      logic: {
        type: "needs_encoding",
        source_logic: cleanText
      },
      citation: "QC Review Instructions",
      messages: {
        reviewer: cleanText,
        appraiser: cleanText
      },
      h1: {
        unique_id: rule_id,
        property_affected: "Subject",
        report_subsection: "{No Subsection}",
        data_point: category,
        min_value: "",
        max_value: "",
        date_format: "",
        field_key: ""
      },
      updated_at: new Date().toISOString()
    };

    newRules.push(rule);
    addedCount++;
  });

  if (newRules.length > 0) {
    const updatedRules = [...existingRules, ...newRules];
    
    // --- TESTING AND RETESTING ---
    console.log("--- RUNNING INTEGRITY AND SCHEMA TESTS ---");
    let testPassed = true;

    // Test 1: IDs must be unique
    const idCountMap = new Map<string, number>();
    for (const r of updatedRules) {
      idCountMap.set(r.rule_id, (idCountMap.get(r.rule_id) || 0) + 1);
    }
    const duplicateIds = Array.from(idCountMap.entries()).filter(([id, count]) => count > 1);
    if (duplicateIds.length > 0) {
      console.error("FAIL: Duplicate IDs found in merged database:", duplicateIds);
      testPassed = false;
    } else {
      console.log("PASS: No duplicate rule IDs in merged database.");
    }

    // Test 2: Rules must conform to basic schema properties
    const schemaFailures: string[] = [];
    updatedRules.forEach(r => {
      if (!r.rule_id) schemaFailures.push(`Missing rule_id for: ${r.description}`);
      if (!r.category) schemaFailures.push(`Rule ${r.rule_id} is missing a category.`);
      if (!r.description) schemaFailures.push(`Rule ${r.rule_id} is missing a description.`);
      if (!["HardStop", "Warning", "Advisory"].includes(r.severity)) {
        schemaFailures.push(`Rule ${r.rule_id} has invalid severity: ${r.severity}`);
      }
      if (!r.logic || !r.logic.type) {
        schemaFailures.push(`Rule ${r.rule_id} is missing logic or logic.type`);
      }
    });

    if (schemaFailures.length > 0) {
      console.error("FAIL: Schema verification failures:\n", schemaFailures.join("\n"));
      testPassed = false;
    } else {
      console.log("PASS: Schema and type validations conform perfectly.");
    }

    if (testPassed) {
      console.log("All validation and integration tests passed successfully!");
      saveRules(updatedRules);
      console.log(`Successfully added ${addedCount} new rules to database. Skipped ${skippedCount} duplicates/existing rules.`);
    } else {
      console.error("CRITICAL: Testing failed. Aborting database save to preserve DB integrity!");
      process.exit(1);
    }
  } else {
    console.log(`No new rules to add. Skipped ${skippedCount} rules because they are already present in the database.`);
  }
}

runImport();
