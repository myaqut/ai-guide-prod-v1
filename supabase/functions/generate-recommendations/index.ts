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
  dates: {
    activeDate?: string;
    endOfSaleDate?: string;
    endOfSupportDate?: string;
  };
  urls: {
    lifecycleUrl?: string;
  };
  sources: string[];
}

// Check if a field is a lifecycle-related field
function isLifecycleField(fieldName: string): boolean {
  const lifecycleKeywords = ['active', 'end of sale', 'end of support', 'end of life', 'lifecycle', 'eol', 'eos'];
  const lowerName = fieldName.toLowerCase();
  return lifecycleKeywords.some(keyword => lowerName.includes(keyword));
}

// Search for lifecycle information using Perplexity API
async function searchLifecycleInfo(componentName: string): Promise<PerplexitySearchResult | null> {
  if (!PERPLEXITY_API_KEY) {
    console.log('Perplexity API key not configured, skipping web search');
    return null;
  }

  try {
    console.log(`Searching lifecycle info for: ${componentName}`);
    
    const searchQuery = `What are the official lifecycle dates for "${componentName}"? 
    I need:
    1. Release date / Active date (when it was released)
    2. End of Sale date (when it stops being sold)
    3. End of Standard Support date / End of Life date
    
    Please provide:
    - Exact dates in YYYY-MM-DD format
    - The official source URL where these dates are documented
    - Only use official vendor documentation, not third-party sources`;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-large-128k-online',
        messages: [
          {
            role: 'system',
            content: `You are a lifecycle research assistant. Search for official product lifecycle information only from vendor sources. 
            Always provide dates in YYYY-MM-DD format when available.
            Always cite the exact URL where the information was found.
            If you cannot find official dates, say so clearly.
            Focus ONLY on the exact product asked about, not similar products.`
          },
          {
            role: 'user',
            content: searchQuery
          }
        ],
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 2000,
        return_images: false,
        return_related_questions: false,
        search_recency_filter: 'year',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Perplexity API error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const citations = data.citations || [];
    
    console.log('Perplexity response:', content);
    console.log('Citations:', citations);

    // Parse the response to extract dates and URLs
    const result: PerplexitySearchResult = {
      dates: {},
      urls: {},
      sources: citations
    };

    // Extract dates from the response using regex patterns
    const datePattern = /(\d{4}-\d{2}-\d{2})/g;
    const dates = content.match(datePattern) || [];
    
    // Try to associate dates with their meaning from context
    const lowerContent = content.toLowerCase();
    
    // Look for release/active date
    if (lowerContent.includes('release') || lowerContent.includes('active') || lowerContent.includes('launched') || lowerContent.includes('available')) {
      const releaseMatch = content.match(/(?:release|active|launched|available|ga).*?(\d{4}-\d{2}-\d{2})/i);
      if (releaseMatch) {
        result.dates.activeDate = releaseMatch[1];
      }
    }
    
    // Look for end of sale date
    if (lowerContent.includes('end of sale') || lowerContent.includes('discontinued') || lowerContent.includes('end-of-sale')) {
      const eosMatch = content.match(/(?:end.?of.?sale|discontinued).*?(\d{4}-\d{2}-\d{2})/i);
      if (eosMatch) {
        result.dates.endOfSaleDate = eosMatch[1];
      }
    }
    
    // Look for end of support date
    if (lowerContent.includes('end of support') || lowerContent.includes('end of life') || lowerContent.includes('eol') || lowerContent.includes('eos')) {
      const eolMatch = content.match(/(?:end.?of.?(?:support|life)|eol|eos).*?(\d{4}-\d{2}-\d{2})/i);
      if (eolMatch) {
        result.dates.endOfSupportDate = eolMatch[1];
      }
    }

    // Extract lifecycle URL from citations or content
    const urlPattern = /https?:\/\/[^\s\)\"]+(?:lifecycle|support|policy|eol|end-of-life)[^\s\)\"]*/gi;
    const foundUrls = content.match(urlPattern) || [];
    if (foundUrls.length > 0) {
      result.urls.lifecycleUrl = foundUrls[0];
    } else if (citations.length > 0) {
      result.urls.lifecycleUrl = citations[0];
    }

    // Store the raw content for the AI to use
    (result as any).rawContent = content;

    return result;
  } catch (error) {
    console.error('Error searching lifecycle info:', error);
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

    const { fields, pageContext } = await req.json();
    console.log('Received fields:', fields);
    console.log('Page context:', pageContext);

    if (!fields || !Array.isArray(fields)) {
      return new Response(
        JSON.stringify({ error: 'Fields array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract the main component name from fields to anchor all recommendations
    const nameField = fields.find((f: FieldData) => f.fieldName?.toLowerCase() === 'name');
    const componentName = nameField?.currentValue || null;

    // Check if any lifecycle fields are being requested
    const hasLifecycleFields = fields.some((f: FieldData) => isLifecycleField(f.fieldName));
    
    // Search for lifecycle info using Perplexity if we have a component name and lifecycle fields
    let lifecycleInfo: PerplexitySearchResult | null = null;
    if (componentName && hasLifecycleFields) {
      console.log('Searching for lifecycle information via Perplexity...');
      lifecycleInfo = await searchLifecycleInfo(componentName);
      console.log('Lifecycle search result:', lifecycleInfo);
    }

    // Build lifecycle context for the AI
    let lifecycleContext = '';
    if (lifecycleInfo) {
      lifecycleContext = `
PERPLEXITY WEB SEARCH RESULTS FOR "${componentName}":
${(lifecycleInfo as any).rawContent || 'No detailed content available'}

Extracted dates:
- Active/Release Date: ${lifecycleInfo.dates.activeDate || 'Not found'}
- End of Sale Date: ${lifecycleInfo.dates.endOfSaleDate || 'Not found'}
- End of Support Date: ${lifecycleInfo.dates.endOfSupportDate || 'Not found'}

Official Lifecycle URL: ${lifecycleInfo.urls.lifecycleUrl || 'Not found'}
Source URLs: ${lifecycleInfo.sources.join(', ') || 'None'}

USE THESE SEARCH RESULTS as your primary source for lifecycle dates and URLs. Include the source URL in your reasoning.
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

${lifecycleContext}

LIFECYCLE DATE FIELDS (Active Date, New End of Sale Date, End of Standard Support, etc.):
- USE THE PERPLEXITY SEARCH RESULTS ABOVE if available
- Provide the date in YYYY-MM-DD format
- In the reasoning, ALWAYS include the official source URL where this date was found
- Example reasoning: "End of Standard Support is 2025-10-14 per official lifecycle policy. Source: https://www.vendor.com/lifecycle"
- If the search results don't contain the exact date, set confidence to 0.5 and explain

LIFECYCLE URL FIELDS (Active Date URL, New End of Sale Date URL, End of Standard Support URL, etc.):
- USE THE LIFECYCLE URL FROM PERPLEXITY SEARCH RESULTS if available
- The recommendation should be the direct URL to the lifecycle/support page
- Common official sources:
  - MongoDB: https://www.mongodb.com/support-policy/lifecycles
  - Microsoft: https://learn.microsoft.com/en-us/lifecycle/products/
  - Oracle: https://www.oracle.com/support/lifetime-support/
  - Red Hat: https://access.redhat.com/support/policy/updates/
  - VMware: https://lifecycle.vmware.com/

For other fields, provide appropriate professional values based on the context.

Respond with a JSON array of recommendations. Each recommendation must have:
- fieldId: the original field ID
- fieldName: the original field name  
- currentValue: the current value (if any)
- recommendation: your suggested value
- confidence: a number between 0 and 1 indicating confidence (use 0.9+ if from Perplexity search, 0.5 if uncertain)
- reasoning: brief explanation (1-2 sentences). For date fields, ALWAYS include the source URL.`;

    const userPrompt = `Given the following catalog fields from an IT Component page, provide recommendations:

Page Context: ${pageContext || 'IT Component catalog entry'}
${componentName ? `\nIMPORTANT: This is for the component "${componentName}" - ALL recommendations must be specifically for this exact product only.\n` : ''}
Fields to analyze:
${fields.map((f: FieldData) => `- ${f.fieldName} (ID: ${f.fieldId})${f.currentValue ? `: current value "${f.currentValue}"` : ': empty'}`).join('\n')}

${lifecycleInfo ? 'Use the Perplexity search results provided in the system prompt for lifecycle dates and URLs.' : ''}

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

    return new Response(
      JSON.stringify({ recommendations }),
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
