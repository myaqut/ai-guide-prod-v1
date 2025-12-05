import { useState, useEffect } from "react";
import { Header } from "./Header";
import { SettingsPanel } from "./SettingsPanel";
import { RecommendationList, FieldRecommendation } from "./RecommendationList";
import { generateRecommendations, FieldData } from "@/lib/api";
import { toast } from "sonner";

// Simulated page data (in real extension, this comes from content script)
const MOCK_FIELDS: FieldData[] = [
  {
    fieldId: "name",
    fieldName: "Name",
    currentValue: "Mongo db 8.2",
  },
  {
    fieldId: "external_id",
    fieldName: "External ID",
    currentValue: "lx_ITC_660317",
  },
  {
    fieldId: "description",
    fieldName: "Description",
    currentValue: "",
  },
  {
    fieldId: "category",
    fieldName: "Category",
    currentValue: "",
  },
  {
    fieldId: "lifecycle_status",
    fieldName: "Lifecycle Status",
    currentValue: "",
  },
];

export const ExtensionPopup = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true); // Assume configured via Cloud
  const [recommendations, setRecommendations] = useState<FieldRecommendation[]>(
    MOCK_FIELDS.map(f => ({ ...f, isLoading: false }))
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleGenerateRecommendations = async () => {
    setIsAnalyzing(true);
    
    // Set all fields to loading
    setRecommendations(prev => prev.map(r => ({ ...r, isLoading: true, recommendation: undefined })));

    try {
      const results = await generateRecommendations(
        MOCK_FIELDS,
        "LeanIX IT Component - MongoDB Database Entry"
      );

      // Map results back to our format
      const updatedRecommendations: FieldRecommendation[] = MOCK_FIELDS.map(field => {
        const rec = results.find(r => r.fieldId === field.fieldId);
        return {
          fieldId: field.fieldId,
          fieldName: field.fieldName,
          currentValue: field.currentValue,
          recommendation: rec?.recommendation,
          confidence: rec?.confidence,
          reasoning: rec?.reasoning,
          isLoading: false,
        };
      });

      setRecommendations(updatedRecommendations);
      toast.success("AI analysis complete!");
    } catch (error) {
      console.error('Error generating recommendations:', error);
      toast.error(error instanceof Error ? error.message : "Failed to generate recommendations");
      setRecommendations(prev => prev.map(r => ({ ...r, isLoading: false })));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApply = (fieldId: string, value: string) => {
    // In a real extension, this would communicate with the content script
    // to update the actual form field on the page
    toast.success(`Applied recommendation to ${fieldId}`);
    
    // Update local state to show the value was applied
    setRecommendations(prev =>
      prev.map(r =>
        r.fieldId === fieldId
          ? { ...r, currentValue: value }
          : r
      )
    );
  };

  return (
    <div className="extension-popup flex flex-col bg-background overflow-hidden rounded-lg border border-border shadow-lg">
      {showSettings ? (
        <SettingsPanel
          onBack={() => setShowSettings(false)}
          apiKey="" // API key is now managed via Cloud
          onSaveApiKey={() => {}} // No-op since managed via Cloud
        />
      ) : (
        <>
          <Header
            onSettingsClick={() => setShowSettings(true)}
            isConnected={apiKeyConfigured}
          />
          <RecommendationList
            recommendations={recommendations}
            isAnalyzing={isAnalyzing}
            onRefresh={handleGenerateRecommendations}
            onApply={handleApply}
          />
        </>
      )}
    </div>
  );
};
