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

// Check if a field is a lifecycle-related field (date or URL)
function isLifecycleField(fieldName: string): boolean {
  const lifecycleKeywords = ['active', 'end of sale', 'end of support', 'end of life', 'lifecycle', 'eol', 'eos', 'release'];
  const lowerName = fieldName.toLowerCase();
  return lifecycleKeywords.some(keyword => lowerName.includes(keyword));
}

// Build a search query based on field type
function buildFieldSearchQuery(componentName: string, fieldName: string): string {
  const lowerFieldName = fieldName.toLowerCase();
  
  // Date-related fields
  if (lowerFieldName.includes('active date') || lowerFieldName.includes('release')) {
    return `"${componentName}" official release date version announcement from vendor YYYY-MM-DD`;
  }
  if (lowerFieldName.includes('end of sale') || lowerFieldName.includes('eos')) {
    return `"${componentName}" end of sale date official announcement YYYY-MM-DD`;
  }
  if (lowerFieldName.includes('end of support') || lowerFieldName.includes('end of life') || lowerFieldName.includes('eol')) {
    return `"${componentName}" end of life end of support date official YYYY-MM-DD`;
  }
  
  // URL fields - search for the corresponding date source
  if (lowerFieldName.includes('url') && lowerFieldName.includes('active')) {
    return `"${componentName}" release announcement official page lifecycle URL`;
  }
  if (lowerFieldName.includes('url') && (lowerFieldName.includes('end of sale') || lowerFieldName.includes('eos'))) {
    return `"${componentName}" end of sale announcement official page URL`;
  }
  if (lowerFieldName.includes('url') && (lowerFieldName.includes('end of support') || lowerFieldName.includes('eol'))) {
    return `"${componentName}" lifecycle support policy official page URL`;
  }
  
  // Description field
  if (lowerFieldName.includes('description')) {
    return `"${componentName}" product description features overview what is`;
  }
  
  // Provider/Vendor field
  if (lowerFieldName.includes('provider') || lowerFieldName.includes('vendor')) {
    return `"${componentName}" vendor company manufacturer who makes`;
  }
  
  // Category field
  if (lowerFieldName.includes('category') || lowerFieldName.includes('type')) {
    return `"${componentName}" software type category classification what kind of software`;
  }
  
  // Lifecycle status
  if (lowerFieldName.includes('lifecycle') || lowerFieldName.includes('status')) {
    return `"${componentName}" lifecycle status current support active or end of life`;
  }
  
  // Default query for lifecycle info
  return `"${componentName}" official product lifecycle dates release end of support`;
}

// Search for field-specific information using Perplexity API
async function searchFieldInfo(componentName: string, fieldName: string): Promise<PerplexitySearchResult | null> {
  if (!PERPLEXITY_API_KEY) {
    console.log('Perplexity API key not configured, skipping web search');
    return null;
  }

  try {
    const searchQuery = buildFieldSearchQuery(componentName, fieldName);
    console.log(`Searching for ${fieldName}: ${searchQuery}`);

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
            content: `You are a product research assistant. Search for official information only from vendor sources. 
            For dates, always provide in YYYY-MM-DD format when available.
            Always cite the exact URL where the information was found.
            If you cannot find official information, say so clearly.
            Focus ONLY on the exact product asked about, not similar products.`
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
      const errorText = await response.text();
      console.error('Perplexity API error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    
    console.log(`Perplexity response for ${fieldName}:`, content.substring(0, 300));
    console.log('Citations:', citations);

    return {
      content,
      urls: citations
    };
  } catch (error) {
    console.error('Error searching field info:', error);
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

    const { fields, pageContext, componentName: passedComponentName } = await req.json();
    console.log('Received fields:', fields);
    console.log('Page context:', pageContext);
    console.log('Passed component name:', passedComponentName);

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
    let searchResults: Record<string, PerplexitySearchResult | null> = {};
    
    if (componentName) {
      // Search for each field that needs web search
      for (const field of fields) {
        const needsSearch = isLifecycleField(field.fieldName) || 
                           field.fieldName.toLowerCase().includes('description') ||
                           field.fieldName.toLowerCase().includes('provider') ||
                           field.fieldName.toLowerCase().includes('category');
        
        if (needsSearch) {
          console.log(`Searching info for field: ${field.fieldName}`);
          const result = await searchFieldInfo(componentName, field.fieldName);
          searchResults[field.fieldId] = result;
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

FOR URL FIELDS (Active Date URL, End of Sale Date URL, etc.):
- The URL MUST point to the EXACT same source as the corresponding date field
- Use the lifecycle URL from search results if available
- Recommend direct URL to the lifecycle/support page

FOR DESCRIPTION FIELDS:
- Use the search results to write a concise, accurate description
- Include key features and purpose of the component

FOR PROVIDER/VENDOR FIELDS:
- Extract the vendor name from search results
- Use official company name (e.g., "MongoDB, Inc." not just "Mongo")

FOR CATEGORY FIELDS:
- Determine the software category (Database, Application Server, Framework, etc.)

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