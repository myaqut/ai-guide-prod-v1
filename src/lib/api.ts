import { supabase } from "@/integrations/supabase/client";

export interface FieldData {
  fieldId: string;
  fieldName: string;
  currentValue?: string;
}

export interface Recommendation {
  fieldId: string;
  fieldName: string;
  currentValue?: string;
  recommendation: string;
  confidence: number;
  reasoning: string;
}

export interface GenerateRecommendationsResult {
  recommendations: Recommendation[];
  cachedUrls?: Record<string, string[]>;
}

export async function generateRecommendations(
  fields: FieldData[],
  pageContext?: string,
  componentName?: string,
  cachedUrls?: Record<string, string[]>
): Promise<GenerateRecommendationsResult> {
  const { data, error } = await supabase.functions.invoke('generate-recommendations', {
    body: { fields, pageContext, componentName, cachedUrls },
  });

  if (error) {
    console.error('Error calling generate-recommendations:', error);
    throw new Error(error.message || 'Failed to generate recommendations');
  }

  if (data.error) {
    console.error('API error:', data.error);
    throw new Error(data.error);
  }

  return {
    recommendations: data.recommendations,
    cachedUrls: data.cachedUrls
  };
}
