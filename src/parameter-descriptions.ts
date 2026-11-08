/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
/** Descriptions shared by equivalent parameters; explicit tool descriptions always win. */
export const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  "startDate": "First date of the reporting period, in YYYY-MM-DD format.",
  "endDate": "Last date of the reporting period, in YYYY-MM-DD format, on or after startDate.",
  "dimensions": "Native reporting dimensions. Validate compatibility with the selected metrics.",
  "metrics": "Native or documented calculated metric names to request. Check compatibility with the selected dimensions.",
  "filters": "Filters combined according to this tool's query schema. Use provider field names and the declared operators.",
};
