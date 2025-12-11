import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
}

interface PerplexitySearchResult {
  content: string;
  urls: string[];
}

// Store URLs found during date field searches for reuse in URL fields
const dateFieldUrlCache: Record<string, string[]> = {};

// Check if a field is a lifecycle-related field (date or URL)
function isLifecycleField(fieldName: string): boolean {
  const lifecycleKeywords = ['active', 'end of sale', 'end of support', 'end of life', 'lifecycle', 'eol', 'eos', 'release', 'standard support', 'endoflife'];
  // Normalize: remove parentheses and extra spaces for matching
  const lowerName = fieldName.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ');
  const fieldId = fieldName.toLowerCase().replace(/[_-]/g, ''); // Also check camelCase fieldId
  return lifecycleKeywords.some(keyword => lowerName.includes(keyword) || fieldId.includes(keyword.replace(/\s+/g, '')));
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

// Build a search query based on field type - prioritizing official sources
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
    // Other
    'vercel': 'vercel.com',
    'netlify': 'netlify.com',
    'heroku': 'heroku.com',
    'digitalocean': 'digitalocean.com',
    'cloudflare': 'cloudflare.com',
    'akamai': 'akamai.com',
    'f5': 'f5.com',
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
6. Do NOT use or cite any third-party sources.`
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
    
    console.log(`[PHASE 1] SUCCESS - Found on official source ${vendorDomain}`);
    console.log(`[PHASE 1] Official citations:`, officialCitations);

    return {
      content: `[VERIFIED FROM OFFICIAL SOURCE: ${vendorDomain}]\n\n${content}`,
      urls: officialCitations,
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

    return {
      content: hasOfficialSource 
        ? content 
        : `[WARNING: NOT FROM OFFICIAL VENDOR WEBSITE - Use with caution]\n\n${content}`,
      urls: citations,
      isOfficialSource: hasOfficialSource || false
    };
  } catch (error) {
    console.error('[PHASE 2] Error:', error);
    return null;
  }
}

// Main search function: Two-phase approach - Official first, then fallback
async function searchFieldInfo(componentName: string, fieldName: string): Promise<PerplexitySearchResult | null> {
  if (!PERPLEXITY_API_KEY) {
    console.log('Perplexity API key not configured, skipping web search');
    return null;
  }

  const vendorDomain = extractVendorDomain(componentName);
  console.log(`\n=== Two-Phase Search for ${fieldName} ===`);
  console.log(`Component: ${componentName}, Vendor Domain: ${vendorDomain || 'unknown'}`);

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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { fields, pageContext, componentName: passedComponentName, cachedUrls: passedCachedUrls } = await req.json();
    console.log('Received fields:', fields);
    console.log('Page context:', pageContext);
    console.log('Passed component name:', passedComponentName);
    console.log('Received cached URLs:', passedCachedUrls);

    if (!fields || !Array.isArray(fields)) {
      return new Response(
        JSON.stringify({ error: 'Fields array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use passed component name (approved earlier), or fall back to extracting from fields
    const nameField = fields.find((f: FieldData) => f.fieldName?.toLowerCase() === 'name');
    const componentName = passedComponentName || nameField?.currentValue || null;
    console.log('Using component name for search:', componentName);

    // CRITICAL: If requesting recommendations for the Name field with no current value,
    // return null recommendation immediately - don't let AI hallucinate random product names
    if (nameField && (!nameField.currentValue || nameField.currentValue.trim() === '') && !passedComponentName) {
      console.log('Name field is empty and no component name provided - returning prompt to enter name');
      return new Response(
        JSON.stringify({ 
          recommendations: [{
            fieldId: nameField.fieldId,
            fieldName: 'Name',
            currentValue: null,
            recommendation: null,
            confidence: 0,
            reasoning: 'Please enter a component name following the format: [Provider Name] + [Product Name] + [Version]. For example: "Microsoft SQL Server 2022 Standard" or "MongoDB Community Server 8.2"'
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
    
    if (componentName) {
      // First pass: Search for date fields and cache their URLs
      for (const field of fields) {
        const cacheKey = getDateFieldCacheKey(field.fieldName);
        const isUrlField = isUrlFieldForCachedDate(field.fieldName);
        
        // Skip URL fields in first pass - they will use cached URLs
        if (isUrlField) {
          console.log(`Skipping URL field (will use cached URL): ${field.fieldName}`);
          continue;
        }
        
        const needsSearch = isLifecycleField(field.fieldName) || 
                           field.fieldName.toLowerCase().includes('description') ||
                           field.fieldName.toLowerCase().includes('provider') ||
                           field.fieldName.toLowerCase().includes('category') ||
                           field.fieldName.toLowerCase().includes('website') ||
                           field.fieldName.toLowerCase().includes('homepage');
        
        console.log(`Field "${field.fieldName}" - isLifecycleField: ${isLifecycleField(field.fieldName)}, needsSearch: ${needsSearch}, cacheKey: ${cacheKey}`);
        
        if (needsSearch) {
          console.log(`Searching info for field: ${field.fieldName}`);
          const result = await searchFieldInfo(componentName, field.fieldName);
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

    const systemPrompt = `You are an AI assistant specialized in IT catalog management. Your job is to suggest values for IT Component catalog fields.

CRITICAL - COMPONENT IDENTITY ANCHOR:
${componentName ? `- The IT Component being cataloged is: "${componentName}"
- ALL your recommendations MUST be specifically about "${componentName}" and NO other product
- Do NOT search for or provide information about different products, versions, or variants
- Do NOT confuse this with similarly named products from other vendors
- Stay strictly focused on the EXACT component: "${componentName}"` : '- No component name provided yet. Suggest an appropriate name based on context.'}

NAMING CONVENTION: Always follow this pattern for the Name field:
[Provider Name] + [Product Name] + [Version]
Examples:
- "MongoDB Community Server 8.2"
- "Oracle Database Enterprise Edition 19c"
- "Microsoft SQL Server 2022 Standard"
- "Apache Kafka 3.5"

${searchContext}

FIELD-SPECIFIC GUIDELINES:

SOURCE QUALITY & CONFIDENCE:
- If search results show "[VERIFIED FROM OFFICIAL SOURCE: ...]", use HIGH confidence (0.85-0.95)
- If search results show "[WARNING: NOT FROM OFFICIAL VENDOR WEBSITE...]", use LOWER confidence (0.5-0.7) and mention this in reasoning
- Official vendor sources should always be preferred and get higher confidence
- Third-party sources should be flagged as such and get reduced confidence

FOR DATE FIELDS (Active Date, End of Sale Date, End of Standard Support, etc.):
- Provide the date in YYYY-MM-DD format
- In the reasoning, ALWAYS include the official source URL where this date was found
- If from OFFICIAL vendor source, use high confidence (0.85-0.95)
- If from THIRD-PARTY source, use lower confidence (0.5-0.7) and state "Source: Third-party website (not official vendor)"
- If no date found, set confidence to 0.4 and explain
- CRITICAL VERSION MATCHING: Match the EXACT version in the component name.
  * If the component is "Product 25.10" (no patch number), this means version 25.10.0 - use the release date for 25.10.0 specifically, NOT 25.10.100 or 25.10.300
  * Version "25.10" = "25.10.0" (the initial .0 release of that minor version)
  * Version "25.10.100" or "25.10.300" are DIFFERENT versions - do NOT use their dates
  * If the search results show multiple version dates, pick the one matching the EXACT version in the component name
  * If the exact version date is not found, set confidence to 0.5 and explain which versions were found

FOR URL FIELDS (Active URL, Active Date URL, End of Sale Date URL, End of Standard Support URL, etc.):
- CRITICAL: The search results will show "MANDATORY URL FOR THIS FIELD: [url]". You MUST use that EXACT URL as your recommendation.
- Do NOT modify, shorten, or change the URL in any way.
- Do NOT search for or recommend a different URL.
- Copy the exact URL from the search results into your recommendation field.
- The reasoning should state that this URL is the same source used to find the corresponding date.
- If the search results say "No official URL was found", recommend null with low confidence (0.3).

FOR DESCRIPTION FIELDS:
- CRITICAL: Keep the description to MAXIMUM 250 characters
- Write a GENERAL description of the product/component, NOT version-specific features
- Describe what the product IS and what it DOES in general terms
- Do NOT mention specific version numbers or version-specific release notes
- Focus on the core purpose, main capabilities, and use cases of the product

FOR PROVIDER/VENDOR FIELDS:
- Extract the vendor name from search results
- Use official company name (e.g., "MongoDB, Inc." not just "Mongo")

FOR CATEGORY FIELDS:
- Determine the software category (Database, Application Server, Framework, etc.)

FOR COMPONENT WEBSITE FIELDS:
- Provide the MAIN product homepage URL (not version-specific pages)
- Use the official vendor website URL for the product (e.g., https://www.liquibase.com not https://www.liquibase.com/downloads/liquibase-4-29-0)
- This should be the general product landing page, NOT a specific version download or release page

Respond with a JSON array of recommendations. Each recommendation must have:
- fieldId: the original field ID
- fieldName: the original field name  
- currentValue: the current value (if any)
- recommendation: your suggested value
- confidence: a number between 0 and 1 (0.85-0.95 for official sources, 0.5-0.7 for third-party, 0.4 or less if uncertain)
- reasoning: brief explanation (1-2 sentences). For date fields, ALWAYS include the source URL and indicate if from official or third-party source.`;

    const userPrompt = `Given the following catalog fields from an IT Component page, provide recommendations:

Page Context: ${pageContext || 'IT Component catalog entry'}
${componentName ? `\nIMPORTANT: This is for the component "${componentName}" - ALL recommendations must be specifically for this exact product only.\n` : ''}
Fields to analyze:
${fields.map((f: FieldData) => `- ${f.fieldName} (ID: ${f.fieldId})${f.currentValue ? `: current value "${f.currentValue}"` : ': empty'}`).join('\n')}

${Object.keys(searchResults).length > 0 ? 'Use the Perplexity search results provided in the system prompt for accurate information.' : ''}

Provide recommendations following the naming convention for the Name field and appropriate professional values for other fields. Return ONLY a valid JSON array.`;

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

    console.log('Parsed recommendations:', recommendations);

    // Return recommendations along with any newly cached URLs so frontend can store them
    return new Response(
      JSON.stringify({ 
        recommendations,
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