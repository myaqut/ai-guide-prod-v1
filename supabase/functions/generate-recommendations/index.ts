import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =====================
// Authentication Helper
// =====================

async function authenticateRequest(req: Request): Promise<{ userId: string } | { error: Response }> {
  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      error: new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    };
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Supabase configuration missing');
    return {
      error: new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    };
  }

  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabaseClient.auth.getUser(token);

  if (error || !data?.user) {
    console.error('Authentication failed:', error?.message);
    return {
      error: new Response(
        JSON.stringify({ error: 'Unauthorized - invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    };
  }

  console.log('[Auth] Request authenticated for user:', data.user.id);
  return { userId: data.user.id };
}

// =====================
// Input Validation Schemas
// =====================

const FieldDataSchema = z.object({
  fieldId: z.string().max(100, 'fieldId must be at most 100 characters'),
  fieldName: z.string().max(200, 'fieldName must be at most 200 characters'),
  currentValue: z.string().max(2000, 'currentValue must be at most 2000 characters').optional(),
});

const CachedUrlsSchema = z.record(
  z.string().max(100),
  z.array(z.string().max(2000)).max(20)
).optional();

const RequestSchema = z.object({
  fields: z.array(FieldDataSchema).max(50, 'Cannot process more than 50 fields at once'),
  pageContext: z.string().max(500, 'pageContext must be at most 500 characters').optional(),
  componentName: z.string().max(300, 'componentName must be at most 300 characters').optional(),
  cachedUrls: CachedUrlsSchema,
  workflowType: z.enum(['itc', 'application']).default('itc'),
  productUrl: z.string().max(2000, 'productUrl must be at most 2000 characters').optional().refine(
    (url) => !url || isValidUrl(url),
    { message: 'productUrl must be a valid URL' }
  ),
});

// Helper to validate URL format
function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// =====================
// URL Accessibility Validation
// =====================

// Validate URL is accessible with a HEAD request (timeout: 5 seconds)
async function isUrlAccessible(url: string): Promise<boolean> {
  if (!isValidUrl(url)) return false;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeanIX-Catalog-Assistant/1.0)',
      },
      redirect: 'follow',
    });
    
    clearTimeout(timeoutId);
    
    // Accept 2xx and 3xx status codes as valid
    const isValid = response.status >= 200 && response.status < 400;
    console.log(`[URL Validation] ${url} -> ${response.status} (${isValid ? 'valid' : 'invalid'})`);
    return isValid;
  } catch (error) {
    // Try GET request as fallback (some servers block HEAD)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LeanIX-Catalog-Assistant/1.0)',
          'Range': 'bytes=0-0', // Only fetch first byte to minimize data transfer
        },
        redirect: 'follow',
      });
      
      clearTimeout(timeoutId);
      
      const isValid = response.status >= 200 && response.status < 400;
      console.log(`[URL Validation GET fallback] ${url} -> ${response.status} (${isValid ? 'valid' : 'invalid'})`);
      return isValid;
    } catch (getError) {
      console.log(`[URL Validation] ${url} -> failed (${error instanceof Error ? error.message : 'unknown error'})`);
      return false;
    }
  }
}

// Validate multiple URLs in parallel with concurrency limit
async function validateUrls(urls: string[], maxConcurrent: number = 3): Promise<string[]> {
  if (!urls || urls.length === 0) return [];
  
  const validatedUrls: string[] = [];
  
  // Process URLs in batches to limit concurrency
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent);
    const results = await Promise.all(
      batch.map(async (url) => {
        const isValid = await isUrlAccessible(url);
        return { url, isValid };
      })
    );
    
    for (const { url, isValid } of results) {
      if (isValid) {
        validatedUrls.push(url);
      }
    }
  }
  
  console.log(`[URL Validation] Validated ${urls.length} URLs, ${validatedUrls.length} accessible`);
  return validatedUrls;
}

// Workflow types
type WorkflowType = 'itc' | 'application';

interface FieldData {
  fieldId: string;
  fieldName: string;
  currentValue?: string;
}

interface RecommendationResponse {
  fieldId: string;
  fieldName: string;
  currentValue?: string;
  recommendation: string;
  confidence: number;
  reasoning: string;
  isOfficialSource?: boolean;
}

interface PerplexitySearchResult {
  content: string;
  urls: string[];
}

// Store URLs found during date field searches for reuse in URL fields
const dateFieldUrlCache: Record<string, string[]> = {};

// =====================
// Fast Inference Functions (Skip Perplexity)
// =====================

// Fields that can be inferred without web search - much faster!
const INFERRABLE_FIELDS = new Set([
  'provider', 'vendor', // Can extract from name
  'lifecycle', 'lifecyclephase', 'phase', 'status', // Default to Active for current products
]);

// Check if field can be inferred without web search
function canInferWithoutSearch(fieldName: string, workflowType: WorkflowType): boolean {
  const lowerName = fieldName.toLowerCase().replace(/[_\-\s]/g, '');
  // Provider can always be inferred from component name
  if (lowerName.includes('provider') || lowerName === 'vendor') return true;
  // Lifecycle phase for applications (they're typically "Active")
  if (workflowType === 'application' && 
      (lowerName.includes('lifecycle') || lowerName.includes('phase'))) return true;
  return false;
}

// Extract provider from component/app name (first word is typically the company)
function inferProviderFromName(componentName: string): string | null {
  if (!componentName) return null;
  const parts = componentName.trim().split(/\s+/);
  if (parts.length === 0) return null;
  
  // Handle multi-word company names
  const multiWordCompanies: Record<string, string> = {
    'microsoft': 'Microsoft',
    'google': 'Google',
    'amazon': 'Amazon',
    'aws': 'Amazon Web Services',
    'oracle': 'Oracle',
    'ibm': 'IBM',
    'sap': 'SAP',
    'vmware': 'VMware',
    'salesforce': 'Salesforce',
    'adobe': 'Adobe',
    'cisco': 'Cisco',
    'red hat': 'Red Hat',
    'redhat': 'Red Hat',
    'palo alto': 'Palo Alto Networks',
    'mongo': 'MongoDB Inc.',
    'mongodb': 'MongoDB Inc.',
    'elastic': 'Elastic',
    'hashicorp': 'HashiCorp',
    'atlassian': 'Atlassian',
    'slack': 'Salesforce (Slack)',
    'snowflake': 'Snowflake Inc.',
    'databricks': 'Databricks',
    'confluent': 'Confluent',
    'datadog': 'Datadog',
    'splunk': 'Cisco (Splunk)',
    'crowdstrike': 'CrowdStrike',
    'okta': 'Okta',
    'auth0': 'Okta (Auth0)',
    'twilio': 'Twilio',
    'stripe': 'Stripe',
    'square': 'Block, Inc.',
    'shopify': 'Shopify',
    'hubspot': 'HubSpot',
    'zendesk': 'Zendesk',
    'freshworks': 'Freshworks',
    'notion': 'Notion Labs',
    'figma': 'Figma (Adobe)',
    'canva': 'Canva',
    'asana': 'Asana',
    'monday': 'monday.com',
    'zoom': 'Zoom Video Communications',
    'webex': 'Cisco (Webex)',
    'infor': 'Infor',
    'workday': 'Workday',
    'servicenow': 'ServiceNow',
    'veeva': 'Veeva Systems',
    'coupa': 'Coupa Software',
    'docusign': 'DocuSign',
    'dropbox': 'Dropbox',
    'box': 'Box, Inc.',
    'github': 'Microsoft (GitHub)',
    'gitlab': 'GitLab',
    'bitbucket': 'Atlassian (Bitbucket)',
    'jira': 'Atlassian (Jira)',
    'confluence': 'Atlassian (Confluence)',
    'trello': 'Atlassian (Trello)',
    'postman': 'Postman',
    'vercel': 'Vercel',
    'netlify': 'Netlify',
    'heroku': 'Salesforce (Heroku)',
    'digitalocean': 'DigitalOcean',
    'cloudflare': 'Cloudflare',
    'akamai': 'Akamai',
    'siemens': 'Siemens',
    'rockwell': 'Rockwell Automation',
    'abb': 'ABB',
    'honeywell': 'Honeywell',
    'schneider': 'Schneider Electric',
  };
  
  // Check for known company name matches
  const lowerName = componentName.toLowerCase();
  for (const [key, fullName] of Object.entries(multiWordCompanies)) {
    if (lowerName.startsWith(key + ' ') || lowerName.startsWith(key + '-')) {
      return fullName;
    }
  }
  
  // Default: return first word with proper capitalization
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

// Generate fast inference result without web search
function generateInferredRecommendation(
  field: { fieldId: string; fieldName: string; currentValue?: string },
  componentName: string,
  workflowType: WorkflowType
): { recommendation: string; confidence: number; reasoning: string } | null {
  const lowerName = field.fieldName.toLowerCase().replace(/[_\-\s]/g, '');
  
  // Provider inference
  if (lowerName.includes('provider') || lowerName === 'vendor') {
    const provider = inferProviderFromName(componentName);
    if (provider) {
      return {
        recommendation: provider,
        confidence: 0.95,
        reasoning: `Provider extracted from ${workflowType === 'itc' ? 'component' : 'application'} name "${componentName}". No web search required.`
      };
    }
  }
  
  // Lifecycle phase for applications (typically Active for cataloged apps)
  if (workflowType === 'application' && 
      (lowerName.includes('lifecycle') || lowerName.includes('phase'))) {
    return {
      recommendation: 'Active',
      confidence: 0.85,
      reasoning: 'Default lifecycle phase for actively cataloged applications. Update if the application is being phased out or planned.'
    };
  }
  
  return null;
}

// =====================
// Version Parsing Utilities
// =====================

// Parse version string into normalized components for precise matching
function parseVersion(versionStr: string): { major: number; minor: number; patch: number; full: string } | null {
  if (!versionStr) return null;
  
  // Extract version number from string (handles "Product 25.10", "v2.5.0", "2022", etc.)
  const versionMatch = versionStr.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!versionMatch) return null;
  
  const major = parseInt(versionMatch[1], 10);
  const minor = versionMatch[2] ? parseInt(versionMatch[2], 10) : 0;
  const patch = versionMatch[3] ? parseInt(versionMatch[3], 10) : 0;
  
  // Build canonical full version string
  const full = versionMatch[3] 
    ? `${major}.${minor}.${patch}` 
    : (versionMatch[2] ? `${major}.${minor}.0` : `${major}.0.0`);
  
  return { major, minor, patch, full };
}

// Extract version from component name
function extractVersionFromName(componentName: string): string | null {
  if (!componentName) return null;
  
  // Match version at end of name: "Product 25.10" or "Product 2022" or "Product v1.2.3"
  const versionMatch = componentName.match(/(?:\s+v?)?(\d+(?:\.\d+)*)\s*$/i);
  return versionMatch ? versionMatch[1] : null;
}

// Generate version matching instruction for search prompts
function getVersionMatchingInstruction(componentName: string): string {
  const version = extractVersionFromName(componentName);
  if (!version) return '';
  
  const parsed = parseVersion(version);
  if (!parsed) return '';
  
  // Create explicit instruction about version matching
  return `
CRITICAL VERSION MATCHING:
- The EXACT version requested is: ${version} (normalized: ${parsed.full})
- You MUST find dates for version ${parsed.full} specifically
- ${parsed.patch === 0 && version.split('.').length <= 2 
    ? `Version "${version}" means "${parsed.full}" - NOT "${parsed.major}.${parsed.minor}.100" or other patch versions`
    : `Match this exact version only`}
- If you find dates for a different version (e.g., ${parsed.major}.${parsed.minor}.${parsed.patch + 100}), that is NOT a match
- Set confidence to 0.5 if you cannot find the exact version`;
}
// Check if a field is a lifecycle-related field (date or URL) - for ITC workflow
function isLifecycleField(fieldName: string): boolean {
  const lifecycleKeywords = ['active', 'end of sale', 'end of support', 'end of life', 'lifecycle', 'eol', 'eos', 'release', 'standard support', 'endoflife'];
  // Normalize: remove parentheses and extra spaces for matching
  const lowerName = fieldName.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ');
  const fieldId = fieldName.toLowerCase().replace(/[_-]/g, ''); // Also check camelCase fieldId
  return lifecycleKeywords.some(keyword => lowerName.includes(keyword) || fieldId.includes(keyword.replace(/\s+/g, '')));
}

// Check if a field needs search for Application workflow
function isApplicationSearchField(fieldName: string): boolean {
  const searchableFields = [
    'description', 'provider', 'vendor', 'business capability', 'hosting', 'data classification',
    'integration', 'gdpr', 'compliance', 'sso', 'authentication', 'pricing', 'category', 'website',
    'api url', 'login url', 'g2 category', 'single sign'
  ];
  const lowerName = fieldName.toLowerCase();
  return searchableFields.some(keyword => lowerName.includes(keyword));
}

// Check if this is a G2 category field that needs G2.com search
function isG2CategoryField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();
  return lowerName.includes('g2') && lowerName.includes('category');
}

// Check if this is a G2 URL field
function isG2UrlField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();
  return lowerName.includes('g2') && lowerName.includes('url');
}

// Check if this is a URL field that should use cached URL from date search
function isUrlFieldForCachedDate(fieldName: string): string | null {
  // Normalize: remove parentheses, underscores, and extra spaces
  const lowerFieldName = fieldName.toLowerCase().replace(/[()_-]/g, ' ').replace(/\s+/g, ' ');
  const fieldId = fieldName.toLowerCase(); // Keep original for ID matching
  
  // Active Date URL / Active URL should use Active Date's URL
  if ((lowerFieldName.includes('url') && lowerFieldName.includes('active') && !lowerFieldName.includes('end')) ||
      fieldId.includes('activedateurl')) {
    return 'active_date';
  }
  // End of Sale URL should use End of Sale Date's URL
  if ((lowerFieldName.includes('url') && (lowerFieldName.includes('end of sale') || lowerFieldName.includes('eos'))) ||
      fieldId.includes('endofsaleurl') || fieldId.includes('eosdateurl')) {
    return 'end_of_sale_date';
  }
  // End of Life / End of (Standard) Support URL - matches "endOfLifeDateUrl"
  if ((lowerFieldName.includes('url') && (
    lowerFieldName.includes('standard support') ||
    lowerFieldName.includes('end of support') || 
    lowerFieldName.includes('end of life') ||
    lowerFieldName.includes('eol')
  )) || fieldId.includes('endoflifedateurl') || fieldId.includes('endofsupporturl')) {
    return 'end_of_support_date';
  }
  
  return null;
}

// Get the cache key for a date field
function getDateFieldCacheKey(fieldName: string): string | null {
  // Normalize: remove parentheses, underscores, and extra spaces
  const lowerFieldName = fieldName.toLowerCase().replace(/[()_-]/g, ' ').replace(/\s+/g, ' ');
  const fieldId = fieldName.toLowerCase(); // Keep original for ID matching
  
  // "Active" field (without URL) - stores release date URL
  if ((lowerFieldName === 'active' || lowerFieldName.includes('active date') || lowerFieldName.includes('active')) && 
      !lowerFieldName.includes('url') && !lowerFieldName.includes('end')) {
    return 'active_date';
  }
  if (((lowerFieldName.includes('end of sale') || lowerFieldName.includes('eos')) && !lowerFieldName.includes('url')) ||
      (fieldId.includes('endofsale') && !fieldId.includes('url'))) {
    return 'end_of_sale_date';
  }
  // End of Life / End of (Standard) Support - matches "lifecyclePhasesEditComponent_endOfLife"
  if (((lowerFieldName.includes('standard support') || lowerFieldName.includes('end of support') || 
       lowerFieldName.includes('end of life') || lowerFieldName.includes('eol')) && !lowerFieldName.includes('url')) ||
      (fieldId.includes('endoflife') && !fieldId.includes('url'))) {
    return 'end_of_support_date';
  }
  
  return null;
}

// Build a search query based on field type - prioritizing official sources (ITC workflow)
function buildFieldSearchQuery(componentName: string, fieldName: string, vendorDomain?: string): string {
  const lowerFieldName = fieldName.toLowerCase();
  
  // Build the official source emphasis based on vendor
  const officialSourceHint = vendorDomain 
    ? `site:${vendorDomain} OR official product lifecycle page` 
    : 'from official vendor website documentation release notes';
  
  // Active field - search for RELEASE DATE from official vendor
  if (lowerFieldName === 'active' || lowerFieldName.includes('active date') || (lowerFieldName.includes('active') && !lowerFieldName.includes('url'))) {
    return `"${componentName}" official release date GA date general availability announcement ${officialSourceHint} YYYY-MM-DD`;
  }
  if (lowerFieldName.includes('end of sale') || lowerFieldName.includes('eos')) {
    return `"${componentName}" end of sale date end of marketing date official lifecycle ${officialSourceHint} YYYY-MM-DD`;
  }
  if (lowerFieldName.includes('end of support') || lowerFieldName.includes('end of life') || lowerFieldName.includes('eol')) {
    return `"${componentName}" end of life end of support EOL date official lifecycle policy ${officialSourceHint} YYYY-MM-DD`;
  }
  
  // Description field - general product description (not version-specific)
  if (lowerFieldName.includes('description')) {
    // Extract base product name without version for general description
    const baseProductName = componentName.replace(/\s+\d+[\d.]*\s*$/, '').replace(/\s+v?\d+[\d.]*\s*$/i, '').trim();
    return `"${baseProductName}" product description what is ${baseProductName} features overview official website`;
  }
  
  // Component Website field - main product homepage (not version-specific)
  if (lowerFieldName.includes('component website') || lowerFieldName.includes('website') || lowerFieldName.includes('homepage')) {
    // Extract base product name without version for main website
    const baseProductName = componentName.replace(/\s+\d+[\d.]*\s*$/, '').replace(/\s+v?\d+[\d.]*\s*$/i, '').trim();
    return `"${baseProductName}" official website homepage main product page`;
  }
  
  // Provider/Vendor field
  if (lowerFieldName.includes('provider') || lowerFieldName.includes('vendor')) {
    return `"${componentName}" official vendor company manufacturer developer`;
  }
  
  // Category field
  if (lowerFieldName.includes('category') || lowerFieldName.includes('type')) {
    return `"${componentName}" software type category classification from official documentation`;
  }
  
  // Lifecycle status
  if (lowerFieldName.includes('lifecycle') || lowerFieldName.includes('status')) {
    return `"${componentName}" lifecycle status current support ${officialSourceHint}`;
  }
  
  // Default query for lifecycle info - emphasize official sources
  return `"${componentName}" official product lifecycle dates release end of support ${officialSourceHint}`;
}

// Build search queries for Application workflow fields
function buildApplicationSearchQuery(appName: string, fieldName: string, vendorDomain?: string, enforceOfficialDomain?: boolean): string {
  const lowerFieldName = fieldName.toLowerCase();
  
  // When enforceOfficialDomain is true and vendorDomain is provided, ONLY search that domain
  const domainFilter = enforceOfficialDomain && vendorDomain ? `site:${vendorDomain}` : '';
  const officialSourceHint = vendorDomain ? `site:${vendorDomain}` : 'official website';
  
  // Description - what the application does
  if (lowerFieldName.includes('description')) {
    return `${domainFilter} "${appName}" SaaS application what is ${appName} features capabilities overview ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // Provider/Vendor
  if (lowerFieldName.includes('provider') || lowerFieldName.includes('vendor')) {
    return `"${appName}" vendor company who makes ${appName} official company`;
  }
  
  // Business Capability
  if (lowerFieldName.includes('business') || lowerFieldName.includes('capability')) {
    return `${domainFilter} "${appName}" business use case what is it used for business capabilities ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // Hosting Description - specifically look for AWS, Azure, GCP, cloud infrastructure
  if (lowerFieldName.includes('hosting')) {
    return `${domainFilter} "${appName}" infrastructure hosting AWS Azure GCP Google Cloud data center cloud hosting on-premise deployment ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // Data Classification
  if (lowerFieldName.includes('data') && lowerFieldName.includes('classification')) {
    return `${domainFilter} "${appName}" data handling security data types processed SOC2 ISO27001 ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // Integrations
  if (lowerFieldName.includes('integration')) {
    return `${domainFilter} "${appName}" integrations API connections supported platforms ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // GDPR Compliance
  if (lowerFieldName.includes('gdpr')) {
    return `${domainFilter} "${appName}" GDPR compliance data privacy EU regulations ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // SSO Provider - specifically look for SSO providers like Okta, Azure AD, etc.
  if (lowerFieldName.includes('sso') || (lowerFieldName.includes('single') && lowerFieldName.includes('sign'))) {
    return `${domainFilter} "${appName}" SSO single sign-on providers Okta Azure AD SAML OAuth authentication supported identity providers ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // API URL - look for API documentation
  if (lowerFieldName.includes('api') && lowerFieldName.includes('url')) {
    return `${domainFilter} "${appName}" API documentation developer docs REST API reference ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // Login URL - look for login page
  if (lowerFieldName.includes('login') && lowerFieldName.includes('url')) {
    return `${domainFilter} "${appName}" login page sign in URL ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
  }
  
  // G2 Category - search on G2.com specifically
  if (lowerFieldName.includes('g2') && lowerFieldName.includes('category')) {
    // Always search G2 for this field, ignore domain restriction
    return `site:g2.com "${appName}" category software reviews`;
  }
  
  // Website
  if (lowerFieldName.includes('website')) {
    return `"${appName}" official website homepage`;
  }
  
  // Lifecycle Phase
  if (lowerFieldName.includes('lifecycle') || lowerFieldName.includes('phase')) {
    return `"${appName}" product status active deprecated end of life`;
  }
  
  // Functional/Technical Fit - these are usually internal assessments, provide guidance
  if (lowerFieldName.includes('functional') || lowerFieldName.includes('technical')) {
    return `"${appName}" reviews ratings G2 Capterra Gartner evaluation`;
  }
  
  // Default
  return `${domainFilter} "${appName}" SaaS application overview features ${!enforceOfficialDomain ? officialSourceHint : ''}`.trim();
}

// Extract vendor/provider from component name for official site search
function extractVendorDomain(componentName: string): string | null {
  const vendorDomains: Record<string, string> = {
    // Major cloud providers
    'google': 'cloud.google.com',
    'microsoft': 'learn.microsoft.com',
    'azure': 'learn.microsoft.com',
    'oracle': 'oracle.com',
    'ibm': 'ibm.com',
    'amazon': 'aws.amazon.com',
    'aws': 'aws.amazon.com',
    // Databases
    'mongodb': 'mongodb.com',
    'postgresql': 'postgresql.org',
    'postgres': 'postgresql.org',
    'mysql': 'mysql.com',
    'mariadb': 'mariadb.com',
    'redis': 'redis.io',
    'couchbase': 'couchbase.com',
    'cassandra': 'cassandra.apache.org',
    'neo4j': 'neo4j.com',
    // Infrastructure & DevOps
    'apache': 'apache.org',
    'docker': 'docker.com',
    'kubernetes': 'kubernetes.io',
    'nginx': 'nginx.com',
    'hashicorp': 'hashicorp.com',
    'terraform': 'hashicorp.com',
    'vaultspeed': 'vaultspeed.com',
    'vault': 'hashicorp.com',
    'consul': 'hashicorp.com',
    'ansible': 'ansible.com',
    'puppet': 'puppet.com',
    'chef': 'chef.io',
    // Elastic & Search
    'elastic': 'elastic.co',
    'elasticsearch': 'elastic.co',
    'kibana': 'elastic.co',
    'logstash': 'elastic.co',
    // Virtualization
    'vmware': 'vmware.com',
    'broadcom vmware': 'vmware.com',
    'citrix': 'citrix.com',
    'proxmox': 'proxmox.com',
    // Enterprise software
    'salesforce': 'salesforce.com',
    'sap': 'sap.com',
    'adobe': 'adobe.com',
    'atlassian': 'atlassian.com',
    'jira': 'atlassian.com',
    'confluence': 'atlassian.com',
    // Version control & CI/CD
    'github': 'docs.github.com',
    'gitlab': 'docs.gitlab.com',
    'bitbucket': 'atlassian.com',
    'jenkins': 'jenkins.io',
    'circleci': 'circleci.com',
    // Monitoring & Analytics
    'datadog': 'datadoghq.com',
    'splunk': 'splunk.com',
    'grafana': 'grafana.com',
    'prometheus': 'prometheus.io',
    'newrelic': 'newrelic.com',
    'dynatrace': 'dynatrace.com',
    // Data platforms
    'snowflake': 'snowflake.com',
    'databricks': 'databricks.com',
    'confluent': 'confluent.io',
    'kafka': 'kafka.apache.org',
    'spark': 'spark.apache.org',
    'hadoop': 'hadoop.apache.org',
    // Web frameworks
    'angular': 'angular.dev',
    'react': 'react.dev',
    'vue': 'vuejs.org',
    'next': 'nextjs.org',
    'nuxt': 'nuxt.com',
    'svelte': 'svelte.dev',
    // Programming languages & runtimes
    'node': 'nodejs.org',
    'python': 'python.org',
    'java': 'oracle.com',
    'openjdk': 'openjdk.org',
    'spring': 'spring.io',
    'dotnet': 'dotnet.microsoft.com',
    '.net': 'dotnet.microsoft.com',
    'ruby': 'ruby-lang.org',
    'php': 'php.net',
    'golang': 'go.dev',
    'rust': 'rust-lang.org',
    // Operating systems
    'redhat': 'access.redhat.com',
    'rhel': 'access.redhat.com',
    'ubuntu': 'ubuntu.com',
    'canonical': 'canonical.com',
    'centos': 'centos.org',
    'debian': 'debian.org',
    'suse': 'suse.com',
    'windows server': 'learn.microsoft.com',
    // Hardware vendors
    'cisco': 'cisco.com',
    'dell': 'dell.com',
    'hp': 'hp.com',
    'hpe': 'hpe.com',
    'lenovo': 'lenovo.com',
    'intel': 'intel.com',
    'nvidia': 'nvidia.com',
    'amd': 'amd.com',
    // Industrial automation
    'siemens': 'siemens.com',
    'tia portal': 'siemens.com',
    'rockwell': 'rockwellautomation.com',
    'allen-bradley': 'rockwellautomation.com',
    'schneider': 'se.com',
    'abb': 'abb.com',
    'honeywell': 'honeywell.com',
    'emerson': 'emerson.com',
    'yokogawa': 'yokogawa.com',
    'mitsubishi electric': 'mitsubishielectric.com',
    'omron': 'omron.com',
    'beckhoff': 'beckhoff.com',
    'plc': 'siemens.com',
    // Security
    'palo alto': 'paloaltonetworks.com',
    'fortinet': 'fortinet.com',
    'crowdstrike': 'crowdstrike.com',
    'okta': 'okta.com',
    'auth0': 'auth0.com',
    // Document & comparison tools
    'draftable': 'draftable.com',
    'workshare': 'workshare.com',
    'litera': 'litera.com',
    // Communication
    'slack': 'slack.com',
    'zoom': 'zoom.us',
    'twilio': 'twilio.com',
    // Popular SaaS Applications
    'notion': 'notion.so',
    'asana': 'asana.com',
    'monday': 'monday.com',
    'trello': 'trello.com',
    'airtable': 'airtable.com',
    'clickup': 'clickup.com',
    'basecamp': 'basecamp.com',
    'wrike': 'wrike.com',
    'smartsheet': 'smartsheet.com',
    // Collaboration & Communication
    'teams': 'microsoft.com',
    'microsoft teams': 'microsoft.com',
    'discord': 'discord.com',
    'webex': 'webex.com',
    'miro': 'miro.com',
    'figma': 'figma.com',
    'canva': 'canva.com',
    'loom': 'loom.com',
    // CRM & Sales
    'hubspot': 'hubspot.com',
    'pipedrive': 'pipedrive.com',
    'zoho': 'zoho.com',
    'zendesk': 'zendesk.com',
    'intercom': 'intercom.com',
    'freshworks': 'freshworks.com',
    'freshdesk': 'freshworks.com',
    'freshsales': 'freshworks.com',
    // Marketing & Analytics
    'mailchimp': 'mailchimp.com',
    'sendgrid': 'sendgrid.com',
    'marketo': 'marketo.com',
    'segment': 'segment.com',
    'mixpanel': 'mixpanel.com',
    'amplitude': 'amplitude.com',
    'hotjar': 'hotjar.com',
    'heap': 'heap.io',
    'google analytics': 'analytics.google.com',
    // HR & Recruiting
    'workday': 'workday.com',
    'bamboohr': 'bamboohr.com',
    'gusto': 'gusto.com',
    'rippling': 'rippling.com',
    'lever': 'lever.co',
    'greenhouse': 'greenhouse.io',
    'infor': 'infor.com',
    'infor hr': 'infor.com',
    'ceridian': 'ceridian.com',
    'adp': 'adp.com',
    'ukg': 'ukg.com',
    'paylocity': 'paylocity.com',
    'paychex': 'paychex.com',
    'namely': 'namely.com',
    'lattice': 'lattice.com',
    '15five': '15five.com',
    'culture amp': 'cultureamp.com',
    // Finance & Accounting
    'quickbooks': 'quickbooks.intuit.com',
    'xero': 'xero.com',
    'stripe': 'stripe.com',
    'square': 'squareup.com',
    'braintree': 'braintreepayments.com',
    'bill.com': 'bill.com',
    'expensify': 'expensify.com',
    'netsuite': 'netsuite.com',
    'sage': 'sage.com',
    'intuit': 'intuit.com',
    'coupa': 'coupa.com',
    'concur': 'concur.com',
    'anaplan': 'anaplan.com',
    // E-commerce
    'shopify': 'shopify.com',
    'bigcommerce': 'bigcommerce.com',
    'woocommerce': 'woocommerce.com',
    'magento': 'magento.com',
    'squarespace': 'squarespace.com',
    'wix': 'wix.com',
    'weebly': 'weebly.com',
    // Developer Tools
    'postman': 'postman.com',
    'swagger': 'swagger.io',
    'sentry': 'sentry.io',
    'launchdarkly': 'launchdarkly.com',
    'pagerduty': 'pagerduty.com',
    'opsgenie': 'atlassian.com',
    'linear': 'linear.app',
    'snyk': 'snyk.io',
    'sonarqube': 'sonarsource.com',
    'jfrog': 'jfrog.com',
    'artifactory': 'jfrog.com',
    // Cloud Storage & Backup
    'dropbox': 'dropbox.com',
    'box': 'box.com',
    'google drive': 'drive.google.com',
    'onedrive': 'onedrive.com',
    'backblaze': 'backblaze.com',
    'egnyte': 'egnyte.com',
    'wasabi': 'wasabi.com',
    // Design & Prototyping
    'sketch': 'sketch.com',
    'invision': 'invisionapp.com',
    'zeplin': 'zeplin.io',
    'abstract': 'abstract.com',
    'framer': 'framer.com',
    // Documentation & Knowledge
    'gitbook': 'gitbook.com',
    'readme': 'readme.com',
    'coda': 'coda.io',
    // Video & Media
    'vimeo': 'vimeo.com',
    'wistia': 'wistia.com',
    'kaltura': 'kaltura.com',
    'cloudinary': 'cloudinary.com',
    'brightcove': 'brightcove.com',
    // Survey & Forms
    'typeform': 'typeform.com',
    'surveymonkey': 'surveymonkey.com',
    'jotform': 'jotform.com',
    'qualtrics': 'qualtrics.com',
    // E-signature
    'docusign': 'docusign.com',
    'hellosign': 'hellosign.com',
    'pandadoc': 'pandadoc.com',
    'adobe sign': 'adobe.com',
    // Customer Success
    'gainsight': 'gainsight.com',
    'churnzero': 'churnzero.com',
    'totango': 'totango.com',
    'planhat': 'planhat.com',
    // Business Intelligence
    'tableau': 'tableau.com',
    'power bi': 'powerbi.com',
    'looker': 'looker.com',
    'domo': 'domo.com',
    'metabase': 'metabase.com',
    'sisense': 'sisense.com',
    'qlik': 'qlik.com',
    'thoughtspot': 'thoughtspot.com',
    // Integration & Automation
    'zapier': 'zapier.com',
    'make': 'make.com',
    'integromat': 'make.com',
    'workato': 'workato.com',
    'tray.io': 'tray.io',
    'mulesoft': 'mulesoft.com',
    'boomi': 'boomi.com',
    // ServiceNow & ITSM
    'servicenow': 'servicenow.com',
    'bmc': 'bmc.com',
    'cherwell': 'cherwell.com',
    'freshservice': 'freshworks.com',
    // Other Enterprise
    'veeva': 'veeva.com',
    'medidata': 'medidata.com',
    'cerner': 'cerner.com',
    'epic': 'epic.com',
    // Cloud Platforms
    'vercel': 'vercel.com',
    'netlify': 'netlify.com',
    'heroku': 'heroku.com',
    'digitalocean': 'digitalocean.com',
    'cloudflare': 'cloudflare.com',
    'akamai': 'akamai.com',
    'f5': 'f5.com',
    'render': 'render.com',
    'railway': 'railway.app',
    'fly.io': 'fly.io',
    'supabase': 'supabase.com',
    'firebase': 'firebase.google.com',
    'planetscale': 'planetscale.com',
  };
  
  const lowerName = componentName.toLowerCase();
  for (const [vendor, domain] of Object.entries(vendorDomains)) {
    if (lowerName.includes(vendor)) {
      return domain;
    }
  }
  return null;
}

// Extended result type with source quality indicator
interface PerplexitySearchResultWithQuality extends PerplexitySearchResult {
  isOfficialSource: boolean;
}

// PHASE 1: Search ONLY on official vendor domain - strict filtering
async function searchOfficialOnly(componentName: string, fieldName: string, vendorDomain: string): Promise<PerplexitySearchResultWithQuality | null> {
  try {
    const searchQuery = buildFieldSearchQuery(componentName, fieldName, vendorDomain);
    
    console.log(`[PHASE 1 - Official Only] Searching ${fieldName} on ${vendorDomain}: ${searchQuery}`);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a product research assistant. You MUST ONLY use information from the official website: ${vendorDomain}

STRICT RULES:
1. ONLY cite and use URLs from ${vendorDomain} - no exceptions.
2. If you cannot find the information on ${vendorDomain}, respond with exactly: "OFFICIAL_SOURCE_NOT_FOUND"
3. For dates, provide in YYYY-MM-DD format.
4. Cite the EXACT URL from ${vendorDomain} where you found the information.
5. Focus on the exact product version asked about.
6. Do NOT use or cite any third-party sources.

${getVersionMatchingInstruction(componentName)}`
          },
          {
            role: 'user',
            content: searchQuery
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 1500,
        return_images: false,
        return_related_questions: false,
        search_domain_filter: [vendorDomain], // ONLY the official domain
      }),
    });

    if (!response.ok) {
      console.error(`[PHASE 1] API error for ${fieldName}:`, response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    // Verify ALL citations are from official domain (support subdomains like support.industry.siemens.com)
    const domainBase = vendorDomain.replace(/^(www\.)?/, '');
    const officialCitations = citations.filter((url: string) => {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname.endsWith(domainBase) || urlObj.hostname === domainBase;
      } catch {
        return url.includes(domainBase);
      }
    });
    
    // Check if response indicates no official source found
    if (content.includes('OFFICIAL_SOURCE_NOT_FOUND') || officialCitations.length === 0) {
      console.log(`[PHASE 1] No official source found for ${fieldName} on ${vendorDomain}`);
      return null;
    }
    
    // Validate URLs are accessible (filter out 404s and broken links)
    console.log(`[PHASE 1] Validating ${officialCitations.length} URLs...`);
    const validatedUrls = await validateUrls(officialCitations, 3);
    
    if (validatedUrls.length === 0) {
      console.log(`[PHASE 1] All URLs returned 404/inaccessible for ${fieldName}`);
      return null;
    }
    
    console.log(`[PHASE 1] SUCCESS - Found ${validatedUrls.length} accessible URLs from ${vendorDomain}`);

    return {
      content: `[VERIFIED FROM OFFICIAL SOURCE: ${vendorDomain}]\n\n${content}`,
      urls: validatedUrls,
      isOfficialSource: true
    };
  } catch (error) {
    console.error('[PHASE 1] Error:', error);
    return null;
  }
}

// PHASE 2: Fallback search without domain restriction (lower confidence)
async function searchFallback(componentName: string, fieldName: string, vendorDomain: string | null): Promise<PerplexitySearchResultWithQuality | null> {
  try {
    const searchQuery = buildFieldSearchQuery(componentName, fieldName, vendorDomain || undefined);
    
    console.log(`[PHASE 2 - Fallback] Broader search for ${fieldName}: ${searchQuery}`);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a product research assistant. This is a FALLBACK search because the official vendor website did not have the information.

RULES:
1. Try to find official vendor information if possible.
2. If using third-party sources, explicitly state: "SOURCE: Third-party (not official vendor website)"
3. For dates, provide in YYYY-MM-DD format.
4. Cite the exact URLs used.
5. Focus on the exact product version asked about.
6. Clearly indicate if the source is NOT the official vendor.
${vendorDomain ? `7. The official domain is ${vendorDomain} - flag if you're NOT using it.` : ''}`
          },
          {
            role: 'user',
            content: searchQuery
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 1500,
        return_images: false,
        return_related_questions: false,
        search_recency_filter: 'year',
      }),
    });

    if (!response.ok) {
      console.error(`[PHASE 2] API error for ${fieldName}:`, response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    // Check if any citation is from official domain (support subdomains)
    const domainBase = vendorDomain?.replace(/^(www\.)?/, '') || '';
    const hasOfficialSource = vendorDomain && citations.some((url: string) => {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname.endsWith(domainBase) || urlObj.hostname === domainBase;
      } catch {
        return url.includes(domainBase);
      }
    });
    
    console.log(`[PHASE 2] Found ${citations.length} citations, official source: ${hasOfficialSource}`);

    // Validate URLs are accessible (filter out 404s and broken links)
    console.log(`[PHASE 2] Validating ${citations.length} URLs...`);
    const validatedUrls = await validateUrls(citations, 3);
    
    if (validatedUrls.length === 0 && citations.length > 0) {
      console.log(`[PHASE 2] All URLs returned 404/inaccessible for ${fieldName}`);
      // Still return content but without URLs
      return {
        content: `[WARNING: Source URLs could not be verified]\n\n${content}`,
        urls: [],
        isOfficialSource: false
      };
    }
    
    // Re-check if any validated URL is from official domain
    const hasValidatedOfficialSource = vendorDomain && validatedUrls.some((url: string) => {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname.endsWith(domainBase) || urlObj.hostname === domainBase;
      } catch {
        return url.includes(domainBase);
      }
    });

    return {
      content: hasValidatedOfficialSource 
        ? content 
        : `[WARNING: NOT FROM OFFICIAL VENDOR WEBSITE - Use with caution]\n\n${content}`,
      urls: validatedUrls,
      isOfficialSource: hasValidatedOfficialSource || false
    };
  } catch (error) {
    console.error('[PHASE 2] Error:', error);
    return null;
  }
}

// =====================
// Application-Specific Search Functions
// =====================

// Search for G2 Category - always on G2.com
async function searchApplicationG2Category(appName: string, vendorDomain: string | null): Promise<PerplexitySearchResultWithQuality | null> {
  try {
    console.log(`[G2 Category] Searching G2.com for ${appName}`);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a G2.com expert. Your task is to find the EXACT G2 category for "${appName}".

CRITICAL INSTRUCTIONS:
1. Search on g2.com/products for "${appName}" 
2. The G2 product page URL format is: https://www.g2.com/products/[product-slug]/reviews
3. The G2 category page URL format is: https://www.g2.com/categories/[category-slug]

IF THE PRODUCT EXISTS ON G2:
- Find the PRIMARY category listed on the product page
- G2 categories are specific like: "CRM Software", "Project Management Software", "IT Service Management (ITSM) Tools", "Endpoint Protection Platforms", "Malware Analysis Tools", etc.
- You MUST include:
  a) The EXACT product page URL (e.g., https://www.g2.com/products/vmray/reviews)
  b) The EXACT category page URL (e.g., https://www.g2.com/categories/malware-analysis-tools)

IF THE PRODUCT IS NOT FOUND ON G2:
- Say "Product not listed on G2"
- Search for the most similar competing products in the same space
- Find what G2 category those competitors are in
- Provide the category name and the category page URL

YOUR RESPONSE MUST INCLUDE:
- Category: [exact G2 category name, be specific]
- Product URL: [full G2 product URL] or "Not listed"  
- Category URL: [full G2 category page URL]
- Status: [Listed on G2 / Not Listed on G2]`
          },
          {
            role: 'user',
            content: `Search G2.com for "${appName}". Return the exact G2 category, product URL (if listed), and category page URL. Be specific with the category name.`
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 600,
        return_images: false,
        return_related_questions: false,
        search_domain_filter: ['g2.com'],
      }),
    });

    if (!response.ok) {
      console.error(`[G2 Category] API error:`, response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    console.log(`[G2 Category] Found ${citations.length} citations, content preview: ${content.substring(0, 300)}`);

    // Extract all G2 URLs from both citations and content
    const allUrls = [...citations];
    
    // Extract any URLs mentioned in the content text
    const urlMatches = content.match(/https?:\/\/(?:www\.)?g2\.com\/[^\s\)\"\'\,\]]+/g) || [];
    for (const url of urlMatches) {
      // Clean up URL (remove trailing punctuation)
      const cleanUrl = url.replace(/[,.\)\]\*]+$/, '');
      if (!allUrls.includes(cleanUrl)) {
        allUrls.push(cleanUrl);
      }
    }
    
    console.log(`[G2 Category] All extracted URLs: ${allUrls.join(', ')}`);

    // Validate G2 URLs are accessible
    const validatedUrls = await validateUrls(allUrls, 3);
    
    console.log(`[G2 Category] Validated URLs: ${validatedUrls.join(', ')}`);

    return {
      content: `[G2.COM CATEGORY SEARCH]\n\n${content}\n\n[VERIFIED G2 URLS]: ${validatedUrls.join(', ')}`,
      urls: validatedUrls,
      isOfficialSource: true // G2 is the authoritative source for G2 categories
    };
  } catch (error) {
    console.error('[G2 Category] Error:', error);
    return null;
  }
}

// Search for SSO Providers supported by the application
async function searchApplicationSSOProviders(appName: string, vendorDomain: string | null, enforceOfficialDomain: boolean): Promise<PerplexitySearchResultWithQuality | null> {
  try {
    console.log(`[SSO Providers] Searching for ${appName}, enforceOfficial: ${enforceOfficialDomain}`);

    const domainFilter = enforceOfficialDomain && vendorDomain ? [vendorDomain] : undefined;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a security research assistant. Find SSO (Single Sign-On) information for "${appName}".

SEARCH FOCUS:
1. Does "${appName}" support SSO/SAML/OAuth authentication?
2. What identity providers are supported? Look for:
   - Okta
   - Azure Active Directory (Azure AD / Entra ID)
   - Google Workspace
   - OneLogin
   - Ping Identity
   - ADFS
   - Generic SAML 2.0
   - OAuth 2.0 / OIDC
3. Is SSO available on all plans or only enterprise?

RESPONSE FORMAT:
- List supported SSO providers explicitly
- Indicate if SSO is available (Yes/No/Enterprise Only)
- Include the URL where SSO documentation is found
${enforceOfficialDomain && vendorDomain ? `\nONLY use information from ${vendorDomain}` : ''}`
          },
          {
            role: 'user',
            content: `What SSO identity providers does "${appName}" support? List specific providers like Okta, Azure AD, etc.`
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 1500,
        return_images: false,
        return_related_questions: false,
        search_domain_filter: domainFilter,
      }),
    });

    if (!response.ok) {
      console.error(`[SSO Providers] API error:`, response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    console.log(`[SSO Providers] Found ${citations.length} citations`);

    return {
      content: `[SSO PROVIDERS SEARCH]\n\n${content}`,
      urls: citations,
      isOfficialSource: enforceOfficialDomain
    };
  } catch (error) {
    console.error('[SSO Providers] Error:', error);
    return null;
  }
}

// Search for API Documentation URL
async function searchApplicationAPIUrl(appName: string, vendorDomain: string | null, enforceOfficialDomain: boolean): Promise<PerplexitySearchResultWithQuality | null> {
  try {
    console.log(`[API URL] Searching for ${appName} API docs, enforceOfficial: ${enforceOfficialDomain}`);

    const domainFilter = enforceOfficialDomain && vendorDomain ? [vendorDomain] : undefined;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a developer documentation research assistant. Find the API documentation URL for "${appName}".

SEARCH FOCUS:
1. Official API documentation page
2. Developer portal or developer docs
3. REST API reference
4. API getting started guide

RESPONSE FORMAT:
- If API documentation exists: Provide the EXACT URL to the API documentation
- If no API exists: State "API not available" or "No public API"
- Include information about API type (REST, GraphQL, etc.)
${enforceOfficialDomain && vendorDomain ? `\nONLY use URLs from ${vendorDomain}` : ''}`
          },
          {
            role: 'user',
            content: `Find the API documentation URL for "${appName}". I need the direct link to their developer/API docs.`
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 1500,
        return_images: false,
        return_related_questions: false,
        search_domain_filter: domainFilter,
      }),
    });

    if (!response.ok) {
      console.error(`[API URL] API error:`, response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    console.log(`[API URL] Found ${citations.length} citations`);

    // Validate API documentation URLs are accessible - critical for URL fields
    const validatedUrls = await validateUrls(citations, 2);

    return {
      content: validatedUrls.length > 0 
        ? `[API DOCUMENTATION SEARCH]\n\n${content}`
        : `[API DOCUMENTATION SEARCH - URLs could not be verified]\n\n${content}`,
      urls: validatedUrls,
      isOfficialSource: enforceOfficialDomain && validatedUrls.length > 0
    };
  } catch (error) {
    console.error('[API URL] Error:', error);
    return null;
  }
}

// Search for Login URL
async function searchApplicationLoginUrl(appName: string, vendorDomain: string | null, enforceOfficialDomain: boolean): Promise<PerplexitySearchResultWithQuality | null> {
  try {
    console.log(`[Login URL] Searching for ${appName} login page, enforceOfficial: ${enforceOfficialDomain}`);

    const domainFilter = enforceOfficialDomain && vendorDomain ? [vendorDomain] : undefined;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a research assistant. Find the login page URL for "${appName}".

SEARCH FOCUS:
1. Official login page URL
2. Sign-in page
3. User authentication page

RESPONSE FORMAT:
- If login page exists: Provide the EXACT URL (e.g., https://app.example.com/login or https://example.com/signin)
- If the application doesn't have a web login (e.g., desktop-only): State "Not available - desktop application only"
- If you cannot find a login page: State "Not available"
${enforceOfficialDomain && vendorDomain ? `\nONLY use URLs from ${vendorDomain}` : ''}`
          },
          {
            role: 'user',
            content: `Find the login page URL for "${appName}". I need the direct link where users sign in.`
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 1000,
        return_images: false,
        return_related_questions: false,
        search_domain_filter: domainFilter,
      }),
    });

    if (!response.ok) {
      console.error(`[Login URL] API error:`, response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    console.log(`[Login URL] Found ${citations.length} citations`);

    // Validate Login URLs are accessible - critical for URL fields
    const validatedUrls = await validateUrls(citations, 2);

    return {
      content: validatedUrls.length > 0
        ? `[LOGIN URL SEARCH]\n\n${content}`
        : `[LOGIN URL SEARCH - URLs could not be verified]\n\n${content}`,
      urls: validatedUrls,
      isOfficialSource: enforceOfficialDomain && validatedUrls.length > 0
    };
  } catch (error) {
    console.error('[Login URL] Error:', error);
    return null;
  }
}

// Search for Hosting/Infrastructure information
async function searchApplicationHosting(appName: string, vendorDomain: string | null, enforceOfficialDomain: boolean): Promise<PerplexitySearchResultWithQuality | null> {
  try {
    console.log(`[Hosting] Searching for ${appName} hosting info, enforceOfficial: ${enforceOfficialDomain}`);

    const domainFilter = enforceOfficialDomain && vendorDomain ? [vendorDomain] : undefined;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are an infrastructure research assistant. Find hosting and infrastructure details for "${appName}".

SEARCH FOCUS:
1. Cloud infrastructure provider:
   - Amazon Web Services (AWS)
   - Microsoft Azure
   - Google Cloud Platform (GCP)
   - Other cloud providers
2. Data center locations/regions
3. Is it SaaS, On-Premise, Hybrid, or PaaS?
4. Any self-hosted options?

RESPONSE FORMAT:
- Specify the cloud provider(s) used (e.g., "Hosted on AWS", "Multi-cloud: AWS and Azure")
- Include data center regions if available
- Indicate hosting model (SaaS/On-Premise/Hybrid)
${enforceOfficialDomain && vendorDomain ? `\nONLY use information from ${vendorDomain}` : ''}`
          },
          {
            role: 'user',
            content: `What cloud infrastructure/hosting does "${appName}" use? Is it on AWS, Azure, GCP, or other?`
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 1500,
        return_images: false,
        return_related_questions: false,
        search_domain_filter: domainFilter,
      }),
    });

    if (!response.ok) {
      console.error(`[Hosting] API error:`, response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    console.log(`[Hosting] Found ${citations.length} citations`);

    return {
      content: `[HOSTING/INFRASTRUCTURE SEARCH]\n\n${content}`,
      urls: citations,
      isOfficialSource: enforceOfficialDomain
    };
  } catch (error) {
    console.error('[Hosting] Error:', error);
    return null;
  }
}

// Main search function: Two-phase approach - Official first, then fallback
// Now accepts optional productUrlDomain to prioritize searches
async function searchFieldInfo(componentName: string, fieldName: string, productUrlDomain?: string | null): Promise<PerplexitySearchResult | null> {
  if (!PERPLEXITY_API_KEY) {
    console.log('Perplexity API key not configured, skipping web search');
    return null;
  }

  // Prefer productUrlDomain if provided, otherwise extract from component name
  const vendorDomain = productUrlDomain || extractVendorDomain(componentName);
  console.log(`\n=== Two-Phase Search for ${fieldName} ===`);
  console.log(`Component: ${componentName}, Vendor Domain: ${vendorDomain || 'unknown'} (from ${productUrlDomain ? 'product URL' : 'component name'})`);

  // PHASE 1: Try official sources only (if we know the vendor)
  if (vendorDomain) {
    const officialResult = await searchOfficialOnly(componentName, fieldName, vendorDomain);
    if (officialResult) {
      console.log(`[RESULT] Using OFFICIAL source for ${fieldName}`);
      return officialResult;
    }
    console.log(`[RESULT] Official source not found, proceeding to Phase 2...`);
  }

  // PHASE 2: Fallback to broader search
  const fallbackResult = await searchFallback(componentName, fieldName, vendorDomain);
  if (fallbackResult) {
    console.log(`[RESULT] Using FALLBACK source for ${fieldName} (isOfficial: ${fallbackResult.isOfficialSource})`);
    return fallbackResult;
  }

  console.log(`[RESULT] No results found for ${fieldName}`);
  return null;
}

// Legacy function - kept for compatibility but now uses two-phase approach
async function searchFieldInfoFallback(componentName: string, fieldName: string, searchQuery: string, vendorDomain: string): Promise<PerplexitySearchResult | null> {
  return searchFallback(componentName, fieldName, vendorDomain);
}

// Build system prompt for IT Component (ITC) workflow
function buildITCSystemPrompt(componentName: string | null, searchContext: string): string {
  return `You are an AI assistant specialized in IT catalog management. Your job is to suggest values for IT Component catalog fields.

CRITICAL - COMPONENT IDENTITY ANCHOR:
${componentName ? `- The IT Component being cataloged is: "${componentName}"
- ALL your recommendations MUST be specifically about "${componentName}" and NO other product` : '- No component name provided yet.'}

NAMING CONVENTION: [Provider Name] + [Product Name] + [Version]
Examples: "MongoDB Community Server 8.2", "Microsoft SQL Server 2022 Standard"

${searchContext}

FOR DATE FIELDS: Provide in YYYY-MM-DD format. Include source URL in reasoning.
FOR URL FIELDS: Use the EXACT URL from search results.
FOR DESCRIPTION: Max 250 characters, general description.
FOR PROVIDER: Use official company name.

Respond with a JSON array. Each item: fieldId, fieldName, currentValue, recommendation, confidence (0-1), reasoning.`;
}

// Build system prompt for Application workflow
function buildApplicationSystemPrompt(appName: string | null, searchContext: string): string {
  return `You are an AI assistant specialized in IT catalog management. Your job is to suggest values for SaaS Application catalog fields.

CRITICAL - APPLICATION IDENTITY ANCHOR:
${appName ? `- The Application being cataloged is: "${appName}"
- ALL your recommendations MUST be specifically about "${appName}"` : '- No application name provided yet.'}

NAMING: Use official product name (e.g., "Salesforce Sales Cloud", "Microsoft Teams"). No version numbers for SaaS.

${searchContext}

FIELD GUIDELINES:
- Description: Max 250 chars, what it does
- Provider: Official company name
- Business Capability: Main function (e.g., "CRM", "Project Management")
- Functional/Technical Fit: "Excellent"/"Good"/"Adequate"/"Insufficient"/"Not Assessed"
- Lifecycle Phase: "Plan"/"Phase In"/"Active"/"Phase Out"/"End of Life"
- Hosting Type: Describe cloud infrastructure (AWS, Azure, GCP, etc.) or "On-Premise"/"Hybrid"
- Data Classification: "Public"/"Internal"/"Confidential"/"Restricted"
- GDPR: "Yes"/"No"/"Partial"/"Unknown"
- SSO Provider: List specific providers (e.g., "Okta, Azure AD, Google") or "Not supported"
- API URL: Direct URL to API documentation, or "Not available"
- Login URL: Direct URL to login page, or "Not available"
- G2 Category: The category name only (e.g., "Malware Analysis Tools", "CRM Software")
- G2 URL: The full G2.com URL - either product page (https://www.g2.com/products/[slug]/reviews) or category page (https://www.g2.com/categories/[slug])

Respond with a JSON array. Each item: fieldId, fieldName, currentValue, recommendation, confidence (0-1), reasoning.`;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Authenticate the request
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) {
    return authResult.error;
  }

  try {
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse and validate request body
    let rawBody;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validationResult = RequestSchema.safeParse(rawBody);
    if (!validationResult.success) {
      console.error('Input validation failed:', validationResult.error.flatten());
      return new Response(
        JSON.stringify({ 
          error: 'Invalid request format', 
          details: validationResult.error.flatten().fieldErrors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { fields, pageContext, componentName: passedComponentName, cachedUrls: passedCachedUrls, workflowType, productUrl } = validationResult.data;
    
    // Log validated input (safe to log now)
    console.log('Validated fields count:', fields.length);
    console.log('Page context:', pageContext?.substring(0, 100));
    console.log('Passed component name:', passedComponentName?.substring(0, 100));
    console.log('Workflow type:', workflowType);
    console.log('Product URL:', productUrl?.substring(0, 100));

    const isApplicationWorkflow = workflowType === 'application';

    // Extract domain from productUrl if provided (for prioritized search)
    let productUrlDomain: string | null = null;
    if (productUrl) {
      try {
        const urlObj = new URL(productUrl);
        productUrlDomain = urlObj.hostname.replace(/^www\./, '');
        console.log('Extracted product URL domain:', productUrlDomain);
      } catch (e) {
        console.log('Could not parse product URL:', e);
      }
    }

    // Use passed component name (approved earlier), or fall back to extracting from fields
    const nameField = fields.find((f: FieldData) => f.fieldName?.toLowerCase() === 'name');
    const componentName = passedComponentName || nameField?.currentValue || null;
    console.log('Using component/app name for search:', componentName);

    // CRITICAL: If requesting recommendations for the Name field with no current value,
    // return null recommendation immediately - don't let AI hallucinate random names
    if (nameField && (!nameField.currentValue || nameField.currentValue.trim() === '') && !passedComponentName) {
      console.log('Name field is empty and no name provided - returning prompt to enter name');
      const nameGuidance = isApplicationWorkflow 
        ? 'Please enter the application name. For example: "Salesforce Sales Cloud" or "Microsoft Teams"'
        : 'Please enter a component name following the format: [Provider Name] + [Product Name] + [Version]. For example: "Microsoft SQL Server 2022 Standard" or "MongoDB Community Server 8.2"';
      return new Response(
        JSON.stringify({ 
          recommendations: [{
            fieldId: nameField.fieldId,
            fieldName: 'Name',
            currentValue: null,
            recommendation: null,
            confidence: 0,
            reasoning: nameGuidance
          }],
          cachedUrls: {}
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For each field, search for specific info using Perplexity
    // Clear and repopulate the URL cache from passed cached URLs
    for (const key in dateFieldUrlCache) {
      delete dateFieldUrlCache[key];
    }
    // Restore any cached URLs passed from the frontend
    if (passedCachedUrls && typeof passedCachedUrls === 'object') {
      for (const [key, urls] of Object.entries(passedCachedUrls)) {
        if (Array.isArray(urls)) {
          dateFieldUrlCache[key] = urls;
          console.log(`Restored cached URLs for ${key}:`, urls);
        }
      }
    }
    
    let searchResults: Record<string, PerplexitySearchResult | null> = {};
    // Store fast inference results for fields that don't need web search
    const inferredResults: Record<string, { recommendation: string; confidence: number; reasoning: string }> = {};
    
    if (componentName) {
      // Use productUrlDomain if available, otherwise extract from component name
      const vendorDomainToUse = productUrlDomain || extractVendorDomain(componentName);
      console.log('Using vendor domain for searches:', vendorDomainToUse);

      // OPTIMIZATION: First pass - handle fields that can be inferred without web search
      for (const field of fields) {
        if (canInferWithoutSearch(field.fieldName, workflowType)) {
          const inferred = generateInferredRecommendation(field, componentName, workflowType);
          if (inferred) {
            console.log(`[FAST INFERENCE] Skipping Perplexity for ${field.fieldName} - inferred directly`);
            inferredResults[field.fieldId] = inferred;
          }
        }
      }

      if (isApplicationWorkflow) {
        // APPLICATION WORKFLOW: Search for SaaS-specific fields
        // Enforce domain-only searches when EITHER:
        // 1. productUrlDomain is provided (user gave a URL), OR
        // 2. vendorDomainToUse was found from the vendor mapping (known vendor)
        const enforceOfficialDomain = !!productUrlDomain || !!vendorDomainToUse;
        console.log(`[Application] Enforce official domain only: ${enforceOfficialDomain}, domain: ${vendorDomainToUse}, source: ${productUrlDomain ? 'productUrl' : (vendorDomainToUse ? 'vendorMapping' : 'none')}`);

        for (const field of fields) {
          // Skip fields that were already inferred
          if (inferredResults[field.fieldId]) {
            console.log(`[Application] Skipping ${field.fieldName} - already inferred`);
            continue;
          }
          
          const needsSearch = isApplicationSearchField(field.fieldName);
          
          if (needsSearch) {
            console.log(`[Application] Searching info for field: ${field.fieldName}`);
            const lowerFieldName = field.fieldName.toLowerCase();
            
            // G2 Category field - always search on G2.com
            if (isG2CategoryField(field.fieldName)) {
              console.log(`[Application] G2 Category field - searching on G2.com`);
              const result = await searchApplicationG2Category(componentName, vendorDomainToUse);
              searchResults[field.fieldId] = result;
              // Cache for G2 URL field
              if (result) {
                searchResults['g2Url'] = result;
              }
            }
            // G2 URL field - reuse G2 Category search results
            else if (isG2UrlField(field.fieldName)) {
              console.log(`[Application] G2 URL field - reusing G2 Category search`);
              // If G2 Category was already searched, reuse; otherwise search now
              if (!searchResults['g2Url']) {
                const result = await searchApplicationG2Category(componentName, vendorDomainToUse);
                searchResults[field.fieldId] = result;
              } else {
                searchResults[field.fieldId] = searchResults['g2Url'];
              }
            }
            // SSO Provider field - search for specific SSO providers
            else if (lowerFieldName.includes('sso') || (lowerFieldName.includes('single') && lowerFieldName.includes('sign'))) {
              console.log(`[Application] SSO Provider field - searching for identity providers`);
              const result = await searchApplicationSSOProviders(componentName, vendorDomainToUse, enforceOfficialDomain);
              searchResults[field.fieldId] = result;
            }
            // API URL field - search for API documentation
            else if (lowerFieldName.includes('api') && lowerFieldName.includes('url')) {
              console.log(`[Application] API URL field - searching for API documentation`);
              const result = await searchApplicationAPIUrl(componentName, vendorDomainToUse, enforceOfficialDomain);
              searchResults[field.fieldId] = result;
            }
            // Login URL field - search for login page
            else if (lowerFieldName.includes('login') && lowerFieldName.includes('url')) {
              console.log(`[Application] Login URL field - searching for login page`);
              const result = await searchApplicationLoginUrl(componentName, vendorDomainToUse, enforceOfficialDomain);
              searchResults[field.fieldId] = result;
            }
            // Hosting Description field - search for infrastructure details
            else if (lowerFieldName.includes('hosting')) {
              console.log(`[Application] Hosting field - searching for cloud infrastructure`);
              const result = await searchApplicationHosting(componentName, vendorDomainToUse, enforceOfficialDomain);
              searchResults[field.fieldId] = result;
            }
            // Other fields - use standard search with domain enforcement
            else {
              const searchQuery = buildApplicationSearchQuery(componentName, field.fieldName, vendorDomainToUse || undefined, enforceOfficialDomain);
              console.log(`[Application] Standard search: ${searchQuery}`);
              
              if (enforceOfficialDomain && vendorDomainToUse) {
                // Use official-only search when domain is provided
                const result = await searchOfficialOnly(componentName, field.fieldName, vendorDomainToUse);
                if (result) {
                  searchResults[field.fieldId] = result;
                } else {
                  // If nothing found on official domain, note that in results
                  searchResults[field.fieldId] = {
                    content: `No information found on official domain (${vendorDomainToUse}). Only official sources are being searched because a product URL was provided.`,
                    urls: []
                  };
                }
              } else {
                // Use fallback search for applications (broader sources acceptable)
                const result = await searchFallback(componentName, field.fieldName, vendorDomainToUse);
                searchResults[field.fieldId] = result;
              }
            }
          }
        }
      } else {
        // ITC WORKFLOW: Original lifecycle-focused search
        // First pass: Search for date fields and cache their URLs
        for (const field of fields) {
          // Skip fields that were already inferred
          if (inferredResults[field.fieldId]) {
            console.log(`[ITC] Skipping ${field.fieldName} - already inferred`);
            continue;
          }
          
          const cacheKey = getDateFieldCacheKey(field.fieldName);
          const isUrlField = isUrlFieldForCachedDate(field.fieldName);
          
          // Skip URL fields in first pass - they will use cached URLs
          if (isUrlField) {
            console.log(`Skipping URL field (will use cached URL): ${field.fieldName}`);
            continue;
          }
          
          // Skip provider for ITC - already inferred above
          const lowerFieldName = field.fieldName.toLowerCase();
          if (lowerFieldName.includes('provider') || lowerFieldName === 'vendor') {
            console.log(`[ITC] Skipping ${field.fieldName} - should be inferred`);
            continue;
          }
          
          const needsSearch = isLifecycleField(field.fieldName) || 
                             field.fieldName.toLowerCase().includes('description') ||
                             field.fieldName.toLowerCase().includes('category') ||
                             field.fieldName.toLowerCase().includes('website') ||
                             field.fieldName.toLowerCase().includes('homepage');
          
          console.log(`Field "${field.fieldName}" - isLifecycleField: ${isLifecycleField(field.fieldName)}, needsSearch: ${needsSearch}, cacheKey: ${cacheKey}`);
          
          if (needsSearch) {
            console.log(`Searching info for field: ${field.fieldName}`);
            const result = await searchFieldInfo(componentName, field.fieldName, vendorDomainToUse);
            searchResults[field.fieldId] = result;
            
            // Cache URLs for date fields so URL fields can reuse them
            if (cacheKey && result && result.urls && result.urls.length > 0) {
              dateFieldUrlCache[cacheKey] = result.urls;
              console.log(`Cached URLs for ${cacheKey}:`, result.urls);
            }
          }
        }
        
        // Second pass: Handle URL fields using cached URLs from date searches
        for (const field of fields) {
          const urlCacheKey = isUrlFieldForCachedDate(field.fieldName);
          
          if (urlCacheKey) {
            const cachedUrls = dateFieldUrlCache[urlCacheKey];
            if (cachedUrls && cachedUrls.length > 0) {
              // Use the first official URL from the date field search - this MUST be the exact same URL
              const officialUrl = cachedUrls[0];
              console.log(`Using cached URL for ${field.fieldName} from ${urlCacheKey}: ${officialUrl}`);
              searchResults[field.fieldId] = {
                content: `MANDATORY URL FOR THIS FIELD: ${officialUrl}
                
This is the EXACT official source URL that was used to find the corresponding date. 
You MUST recommend this exact URL: ${officialUrl}
Do NOT recommend any other URL. The recommendation field value must be exactly: ${officialUrl}`,
                urls: [officialUrl] // Only pass the single URL to avoid confusion
              };
            } else {
              console.log(`No cached URL found for ${field.fieldName} (cache key: ${urlCacheKey})`);
              searchResults[field.fieldId] = {
                content: 'No official URL was found during the date field search. The corresponding date field did not return any official source URLs. Recommend null or empty value.',
                urls: []
              };
            }
          }
        }
      }
    }

    // Build context from all search results
    let searchContext = '';
    if (Object.keys(searchResults).length > 0) {
      searchContext = `
WEB SEARCH RESULTS FOR "${componentName}":
${Object.entries(searchResults).map(([fieldId, result]) => {
  if (!result) return '';
  const field = fields.find((f: FieldData) => f.fieldId === fieldId);
  return `
--- Results for ${field?.fieldName || fieldId} ---
${result.content}
Sources: ${result.urls.join(', ')}
`;
}).filter(Boolean).join('\n')}

USE THESE SEARCH RESULTS as your primary source. Include the source URL in your reasoning for dates.
`;
    }

    // Build workflow-specific system prompt
    const systemPrompt = isApplicationWorkflow 
      ? buildApplicationSystemPrompt(componentName, searchContext)
      : buildITCSystemPrompt(componentName, searchContext);

    const entityType = isApplicationWorkflow ? 'Application' : 'IT Component';
    
    // Filter out fields that were inferred - we don't need AI to process them
    const fieldsNeedingAI = fields.filter((f: FieldData) => !inferredResults[f.fieldId]);
    
    // Log optimization stats
    console.log(`[OPTIMIZATION] Total fields: ${fields.length}, Inferred locally: ${Object.keys(inferredResults).length}, Sent to AI: ${fieldsNeedingAI.length}`);
    
    // If all fields were inferred, skip AI call entirely
    if (fieldsNeedingAI.length === 0) {
      console.log('[OPTIMIZATION] All fields inferred - skipping AI Gateway call');
      const fastRecommendations = fields.map((f: FieldData) => ({
        fieldId: f.fieldId,
        fieldName: f.fieldName,
        currentValue: f.currentValue || null,
        ...inferredResults[f.fieldId],
        isOfficialSource: false
      }));
      
      return new Response(
        JSON.stringify({ 
          recommendations: fastRecommendations,
          cachedUrls: dateFieldUrlCache
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const userPrompt = `Given the following catalog fields from a ${entityType} page, provide recommendations:

Page Context: ${pageContext || `LeanIX ${entityType} catalog entry`}
${componentName ? `\nIMPORTANT: This is for "${componentName}" - ALL recommendations must be specifically for this exact ${entityType.toLowerCase()} only.\n` : ''}
Fields to analyze:
${fieldsNeedingAI.map((f: FieldData) => `- ${f.fieldName} (ID: ${f.fieldId})${f.currentValue ? `: current value "${f.currentValue}"` : ': empty'}`).join('\n')}

${Object.keys(searchResults).length > 0 ? 'Use the search results provided in the system prompt for accurate information.' : ''}

Provide recommendations with appropriate professional values for all fields. Return ONLY a valid JSON array.`;

    console.log('Calling Lovable AI Gateway...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits in Settings -> Workspace -> Usage.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Failed to get AI recommendations', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('AI response received');

    const content = data.choices[0]?.message?.content;
    if (!content) {
      return new Response(
        JSON.stringify({ error: 'No content in AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the JSON response from the AI
    let recommendations: RecommendationResponse[];
    try {
      // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        recommendations = JSON.parse(jsonMatch[0]);
      } else {
        recommendations = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Raw content:', content);
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI recommendations', rawContent: content }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Enrich recommendations with isOfficialSource from search results
    const enrichedRecommendations = recommendations.map(rec => {
      const searchResult = searchResults[rec.fieldId] as PerplexitySearchResultWithQuality | null;
      return {
        ...rec,
        isOfficialSource: searchResult?.isOfficialSource ?? false
      };
    });
    
    // Merge inferred results with AI-generated recommendations
    const allRecommendations: RecommendationResponse[] = [
      // First, add inferred results
      ...Object.entries(inferredResults).map(([fieldId, inferred]) => {
        const field = fields.find((f: FieldData) => f.fieldId === fieldId);
        return {
          fieldId,
          fieldName: field?.fieldName || fieldId,
          currentValue: field?.currentValue || null,
          recommendation: inferred.recommendation,
          confidence: inferred.confidence,
          reasoning: inferred.reasoning,
          isOfficialSource: false // Inferred results are not from official sources
        } as RecommendationResponse;
      }),
      // Then add AI-generated recommendations
      ...enrichedRecommendations
    ];

    console.log('Parsed recommendations:', allRecommendations);
    console.log(`[OPTIMIZATION] Returned ${Object.keys(inferredResults).length} inferred + ${enrichedRecommendations.length} AI-generated = ${allRecommendations.length} total`);

    // Return recommendations along with any newly cached URLs so frontend can store them
    return new Response(
      JSON.stringify({ 
        recommendations: allRecommendations,
        cachedUrls: dateFieldUrlCache  // Return cached URLs so frontend can pass them in future requests
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-recommendations function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
