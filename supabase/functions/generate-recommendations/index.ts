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

// Search for field-specific information using Perplexity API
async function searchFieldInfo(componentName: string, fieldName: string): Promise<PerplexitySearchResult | null> {
  if (!PERPLEXITY_API_KEY) {
    console.log('Perplexity API key not configured, skipping web search');
    return null;
  }

  try {
    const vendorDomain = extractVendorDomain(componentName);
    const searchQuery = buildFieldSearchQuery(componentName, fieldName, vendorDomain || undefined);
    
    // Build search instruction prioritizing official website
    let searchInstruction = '';
    if (vendorDomain) {
      searchInstruction = `PRIORITY: Search FIRST on the official website (${vendorDomain}) for this information.
If the information is found on ${vendorDomain}, use it and cite that URL.
If NOT found on ${vendorDomain}, you may search other sources BUT you MUST explicitly state: "This information was NOT found on the official website (${vendorDomain})" in your response.`;
    } else {
      searchInstruction = `Search for official vendor documentation and announcements. If you cannot find information on an official vendor website, explicitly state this in your response.`;
    }
    
    console.log(`Searching for ${fieldName}: ${searchQuery}`);
    console.log(`Vendor domain for priority search: ${vendorDomain || 'unknown'}`);

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
            content: `You are a product research assistant specializing in finding OFFICIAL vendor information.

${searchInstruction}

CRITICAL RULES - OFFICIAL SOURCES ONLY:
1. You MUST prioritize and use ONLY official vendor websites and documentation.
2. For dates, always provide in YYYY-MM-DD format when available.
3. Always cite the EXACT official URL where the information was found.
4. If information comes from a third-party site (not the official vendor), you MUST clearly state: "NOT FROM OFFICIAL SOURCE".
5. Focus ONLY on the exact product asked about, not similar products or different versions.
6. ONLY use official documentation, release notes, lifecycle pages, and support announcements.
7. If you cannot find official information, clearly state "Official source not found" in your response.
8. DO NOT use Wikipedia, blogs, or other unofficial sources as primary references.`
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
        search_domain_filter: vendorDomain ? [vendorDomain, 'endoflife.date'] : undefined,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Perplexity API error:', response.status, errorText);
      
      // If domain filter fails, retry without it
      if (vendorDomain) {
        console.log('Retrying search without domain filter...');
        return searchFieldInfoFallback(componentName, fieldName, searchQuery, vendorDomain);
      }
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    // Check if any citation is from the official domain
    const hasOfficialSource = vendorDomain && citations.some((url: string) => url.includes(vendorDomain));
    let enrichedContent = content;
    
    if (vendorDomain && !hasOfficialSource && citations.length > 0) {
      enrichedContent = `[NOTE: Information NOT found on official website (${vendorDomain}). Sources used: ${citations.join(', ')}]\n\n${content}`;
    }
    
    console.log(`Perplexity response for ${fieldName}:`, enrichedContent.substring(0, 300));
    console.log('Citations:', citations);
    console.log(`Has official source (${vendorDomain}):`, hasOfficialSource);

    return {
      content: enrichedContent,
      urls: citations
    };
  } catch (error) {
    console.error('Error searching field info:', error);
    return null;
  }
}

// Fallback search without domain filter
async function searchFieldInfoFallback(componentName: string, fieldName: string, searchQuery: string, vendorDomain: string): Promise<PerplexitySearchResult | null> {
  try {
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
            content: `You are a product research assistant. Search for OFFICIAL vendor information ONLY.
CRITICAL: You MUST prioritize official vendor websites and documentation.
IMPORTANT: If the information is NOT from the official website (${vendorDomain}), explicitly state "NOT FROM OFFICIAL SOURCE".
For dates, always provide in YYYY-MM-DD format when available.
Always cite the EXACT official URL where the information was found.
Focus ONLY on the exact product asked about, not similar products.
DO NOT use Wikipedia, blogs, or other unofficial sources as primary references.`
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
      console.error('Fallback search also failed');
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    // Check if any citation is from the official domain
    const hasOfficialSource = citations.some((url: string) => url.includes(vendorDomain));
    let enrichedContent = content;
    
    if (!hasOfficialSource && citations.length > 0) {
      enrichedContent = `[NOTE: Information NOT found on official website (${vendorDomain}). Sources used: ${citations.join(', ')}]\n\n${content}`;
    }
    
    console.log(`Fallback response for ${fieldName}:`, enrichedContent.substring(0, 300));

    return {
      content: enrichedContent,
      urls: citations
    };
  } catch (error) {
    console.error('Error in fallback search:', error);
    return null;
  }
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
            // Use the first official URL from the date field search
            const officialUrl = cachedUrls[0];
            console.log(`Using cached URL for ${field.fieldName} from ${urlCacheKey}: ${officialUrl}`);
            searchResults[field.fieldId] = {
              content: `Official source URL from corresponding date field search: ${officialUrl}`,
              urls: cachedUrls
            };
          } else {
            console.log(`No cached URL found for ${field.fieldName} (cache key: ${urlCacheKey})`);
            searchResults[field.fieldId] = {
              content: 'No official URL was found during the date field search. The corresponding date field did not return any official source URLs.',
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

FOR DATE FIELDS (Active Date, End of Sale Date, End of Standard Support, etc.):
- Provide the date in YYYY-MM-DD format
- In the reasoning, ALWAYS include the official source URL where this date was found
- If search results contain the date, use it with high confidence (0.9+)
- If no date found, set confidence to 0.5 and explain
- CRITICAL VERSION MATCHING: Match the EXACT version in the component name.
  * If the component is "Product 25.10" (no patch number), this means version 25.10.0 - use the release date for 25.10.0 specifically, NOT 25.10.100 or 25.10.300
  * Version "25.10" = "25.10.0" (the initial .0 release of that minor version)
  * Version "25.10.100" or "25.10.300" are DIFFERENT versions - do NOT use their dates
  * If the search results show multiple version dates, pick the one matching the EXACT version in the component name
  * If the exact version date is not found, set confidence to 0.5 and explain which versions were found

FOR URL FIELDS (Active URL, End of Sale Date URL, End of Standard Support URL, etc.):
- CRITICAL: Do NOT search for new URLs. Use ONLY the URL that was already found during the corresponding date field search.
- The URL recommendation MUST be the EXACT same official URL used to find the date.
- If the search results show "Official source URL from corresponding date field search", use that URL directly.
- If no URL was found during date search, recommend an empty value with low confidence.
- The URL must be from the OFFICIAL vendor website only.

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
- confidence: a number between 0 and 1 (use 0.9+ if from search, 0.5 if uncertain)
- reasoning: brief explanation (1-2 sentences). For date fields, ALWAYS include the source URL.`;

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