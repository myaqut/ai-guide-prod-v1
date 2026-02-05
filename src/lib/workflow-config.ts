// Workflow type definitions
export type WorkflowType = 'itc' | 'application' | 'provider' | 'chat';

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

// Application (SaaS) fields - simplified 10-field implementation
export const APPLICATION_FIELDS: FieldConfig[] = [
  { fieldId: 'name', fieldName: 'Name', priority: 1, description: 'Application name' },
  { fieldId: 'description', fieldName: 'Description', priority: 2, description: 'What the application does' },
  { fieldId: 'sid', fieldName: 'SID', priority: 3, description: 'Product name without spaces' },
  { fieldId: 'webpageUrl', fieldName: 'Webpage URL', priority: 4, description: 'Official product website' },
  { fieldId: 'productCategory', fieldName: 'Product Category', priority: 5, description: 'G2 category, or similar product category if not listed' },
  { fieldId: 'pricingType', fieldName: 'Pricing Type', priority: 6, description: 'Pricing policy summary (max 200 chars)' },
  { fieldId: 'pricingUrl', fieldName: 'Pricing URL', priority: 7, description: 'Official pricing page URL' },
  { fieldId: 'hostingDescription', fieldName: 'Hosting Description', priority: 8, description: 'Hosting servers (e.g., AWS, Azure, GCP)' },
  { fieldId: 'ssoStatus', fieldName: 'SSO Status', priority: 9, description: 'Whether product supports SSO' },
  { fieldId: 'internalComment', fieldName: 'Internal Comment', priority: 10, description: 'G2 category page URL' },
];

// Provider (Company Research) fields - new implementation
export const PROVIDER_FIELDS: FieldConfig[] = [
  { fieldId: 'name', fieldName: 'Company Name', priority: 1, description: 'Official company name' },
  { fieldId: 'description', fieldName: 'Description', priority: 2, description: 'Short company description (max 200 characters)' },
  { fieldId: 'foundationDate', fieldName: 'Foundation Date', priority: 3, description: 'Year or date the company was founded' },
  { fieldId: 'homepage', fieldName: 'Homepage URL', priority: 4, description: 'Official company website' },
  { fieldId: 'announcementPage', fieldName: 'Announcement Page', priority: 5, description: 'News, press releases, or blog page' },
  { fieldId: 'supportEmail', fieldName: 'Support Email', priority: 6, description: 'Customer support email address' },
  { fieldId: 'supportPage', fieldName: 'Support Page', priority: 7, description: 'Customer support or help center URL' },
  { fieldId: 'contactPage', fieldName: 'Contact Us Page', priority: 8, description: 'Contact page URL' },
  { fieldId: 'headquartersAddress', fieldName: 'Headquarters Address', priority: 9, description: 'Full address in one line' },
  { fieldId: 'headquartersCity', fieldName: 'City', priority: 10, description: 'City where headquarters is located' },
  { fieldId: 'headquartersCountry', fieldName: 'Country', priority: 11, description: 'Country where headquarters is located' },
  { fieldId: 'phoneNumber', fieldName: 'Phone', priority: 12, description: 'Main company phone number' },
];

export function getFieldsForWorkflow(workflow: WorkflowType): FieldConfig[] {
  if (workflow === 'chat') return []; // Chat doesn't have fields
  if (workflow === 'itc') return ITC_FIELDS;
  if (workflow === 'application') return APPLICATION_FIELDS;
  return PROVIDER_FIELDS;
}

export function getWorkflowLabel(workflow: WorkflowType): string {
  if (workflow === 'chat') return 'Research Chat';
  if (workflow === 'itc') return 'IT Component';
  if (workflow === 'application') return 'Application';
  return 'Provider';
}

export function getPageContext(workflow: WorkflowType): string {
  if (workflow === 'chat') return 'Research Chat';
  if (workflow === 'itc') return 'LeanIX IT Component';
  if (workflow === 'application') return 'LeanIX Application';
  return 'LeanIX Provider';
}

// Name validation patterns differ by workflow
export function isValidNameFormat(name: string, workflow: WorkflowType): boolean {
  if (!name || name.trim().length < 3) return false;
  
  if (workflow === 'chat') return true; // Chat doesn't need name validation
  
  // Provider workflow: Just need a company name (at least 2 chars)
  if (workflow === 'provider') {
    return name.trim().length >= 2;
  }
  
  const parts = name.trim().split(/\s+/);
  
  if (workflow === 'itc') {
    // ITC: Must have at least 2 parts (Company + Product)
    if (parts.length < 2) return false;
    // First part should be capitalized (company name)
    if (!/^[A-Z]/.test(parts[0])) return false;
    // ITC: Company + Product + Version pattern (version can be numbers, x.x format, or year)
    const lastPart = parts[parts.length - 1];
    const hasVersion = /\d/.test(lastPart);
    return hasVersion;
  } else {
    // Application: Company + Product Name (no version needed for SaaS)
    if (parts.length < 2) return false;
    if (!/^[A-Z]/.test(parts[0])) return false;
    return parts.length >= 2 && name.trim().length >= 5;
  }
}

export function getNameFormatGuidance(workflow: WorkflowType): string {
  if (workflow === 'chat') {
    return 'Research Chat - ask any question';
  }
  if (workflow === 'provider') {
    return 'Enter the company name. Example: "Microsoft" or "Salesforce"';
  }
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
