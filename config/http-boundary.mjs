// Exhaustive route classification. A new API must be reviewed before the gate passes.
export const RETIRED_API_PATHS = Object.freeze([
  'connectors','customers','import-preview','imports','imports/preview','ingestion',
  'mapping-templates','policy','products','prototype-import','quotes',
  'quotes/[quoteId]/decision','quotes/[quoteId]/send','search','tenant/export',
]);
export const CONTROL_API_PATHS = Object.freeze([
  'audit','auth/login','auth/logout','dev/impersonate','dev/impersonate/stop',
  'health','invites','tenant/delete','tenant/switch','tenants','users','users/[userId]',
  'licence','licence/seats','licence/locations','licence/devices',
]);
export const RETIRED_PAGE_PATHS = Object.freeze([
  'dashboard','prices','quoting','rebates','account/data','account/policy',
  'legacy/dashboard','legacy/prices','legacy/quoting','legacy/rebates',
  'legacy/account/data','legacy/account/policy','legacy/account/audit',
]);
export const CONTROL_TABLES = Object.freeze([
  'tenant','membership','invite','audit_log','workspace_licence','licence_seat','licence_location','licence_device',
]);
