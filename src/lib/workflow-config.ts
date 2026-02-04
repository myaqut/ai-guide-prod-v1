// Workflow type definitions
export type WorkflowType = 'itc' | 'application';

// Field configurations for each workflow type
export interface FieldConfig {
  fieldId: string;
  fieldName: string;
  priority: number; // Lower = higher priority for ordering
  description?: string;
}

// IT Component (ITC) fields - current implementation
export const ITC_FIELDS: FieldConfig[] = [
  { fieldId: 'name', fieldName: 'Name', priority: 1, description: 'Provider + Product + Version' },
  { fieldId: 'provider', fieldName: 'Provider', priority: 2, description: 'Vendor/Company name' },
  { fieldId: 'description', fieldName: 'Description', priority: 3, description: 'Product description' },
  { fieldId: 'category', fieldName: 'Category', priority: 4, description: 'Software category' },
  { fieldId: 'active', fieldName: 'Active (Release Date)', priority: 5, description: 'Release/GA date' },
  { fieldId: 'activeDateUrl', fieldName: 'Active Date URL', priority: 6, description: 'Source URL for release date' },
  { fieldId: 'endOfSale', fieldName: 'End of Sale Date', priority: 7, description: 'End of marketing date' },
  { fieldId: 'endOfSaleUrl', fieldName: 'End of Sale Date URL', priority: 8, description: 'Source URL for EOS' },
  { fieldId: 'endOfSupport', fieldName: 'End of Standard Support', priority: 9, description: 'End of support date' },
  { fieldId: 'endOfSupportUrl', fieldName: 'End of Standard Support URL', priority: 10, description: 'Source URL for EOL' },
  { fieldId: 'componentWebsite', fieldName: 'Component Website', priority: 11, description: 'Official product homepage' },
];

// Application (SaaS) fields - new implementation
export const APPLICATION_FIELDS: FieldConfig[] = [
  { fieldId: 'name', fieldName: 'Name', priority: 1, description: 'Application name' },
  { fieldId: 'description', fieldName: 'Description', priority: 2, description: 'What the application does' },
  { fieldId: 'provider', fieldName: 'Provider', priority: 3, description: 'Vendor/Company name' },
  { fieldId: 'businessCapability', fieldName: 'Business Capability', priority: 4, description: 'Main business function supported' },
  { fieldId: 'functionalFit', fieldName: 'Functional Fit', priority: 5, description: 'How well it fits business needs' },
  { fieldId: 'technicalFit', fieldName: 'Technical Fit', priority: 6, description: 'Technical suitability assessment' },
  { fieldId: 'lifecyclePhase', fieldName: 'Lifecycle Phase', priority: 7, description: 'Current phase (Plan, Active, Phase Out, End of Life)' },
  { fieldId: 'hostingType', fieldName: 'Hosting Type', priority: 8, description: 'SaaS, On-Premise, Hybrid, PaaS' },
  { fieldId: 'dataClassification', fieldName: 'Data Classification', priority: 9, description: 'Data sensitivity level' },
  { fieldId: 'integrations', fieldName: 'Key Integrations', priority: 10, description: 'Main integrations/connections' },
  { fieldId: 'website', fieldName: 'Application Website', priority: 11, description: 'Official vendor/product URL' },
  { fieldId: 'gdprCompliant', fieldName: 'GDPR Compliant', priority: 12, description: 'GDPR compliance status' },
  { fieldId: 'ssoEnabled', fieldName: 'SSO Enabled', priority: 13, description: 'Single Sign-On support' },
];

export function getFieldsForWorkflow(workflow: WorkflowType): FieldConfig[] {
  return workflow === 'itc' ? ITC_FIELDS : APPLICATION_FIELDS;
}

export function getWorkflowLabel(workflow: WorkflowType): string {
  return workflow === 'itc' ? 'IT Component' : 'Application';
}

export function getPageContext(workflow: WorkflowType): string {
  return workflow === 'itc' ? 'LeanIX IT Component' : 'LeanIX Application';
}

// Name validation patterns differ by workflow
// New format: [Company Name] + [Component/Application Name] (+ [Version] for ITC)
export function isValidNameFormat(name: string, workflow: WorkflowType): boolean {
  if (!name || name.trim().length < 3) return false;
  
  const parts = name.trim().split(/\s+/);
  
  // Must have at least 2 parts (Company + Product)
  if (parts.length < 2) return false;
  
  // First part should be capitalized (company name)
  const hasCompany = /^[A-Z]/.test(parts[0]);
  if (!hasCompany) return false;
  
  if (workflow === 'itc') {
    // ITC: Company + Product + Version pattern (version can be numbers, x.x format, or year)
    // Examples: "Microsoft SQL Server 2022", "MongoDB Community Server 8.2", "Apache Kafka 3.6.0"
    const lastPart = parts[parts.length - 1];
    const hasVersion = /\d/.test(lastPart);
    return hasVersion;
  } else {
    // Application: Company + Product Name (no version needed for SaaS)
    // Examples: "Salesforce Sales Cloud", "Microsoft Teams", "Slack Enterprise Grid"
    return parts.length >= 2 && name.trim().length >= 5;
  }
}

export function getNameFormatGuidance(workflow: WorkflowType): string {
  if (workflow === 'itc') {
    return 'Name should follow: [Company] + [Product] + [Version]. Example: "Microsoft SQL Server 2022"';
  } else {
    return 'Name should follow: [Company] + [Product]. Example: "Salesforce Sales Cloud" or "Microsoft Teams"';
  }
}

// Extract company name from the component/application name
export function extractCompanyName(name: string): string | null {
  if (!name || name.trim().length < 2) return null;
  const parts = name.trim().split(/\s+/);
  return parts[0] || null;
}
