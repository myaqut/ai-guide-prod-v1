import { useState, useEffect } from "react";
import { Header } from "./Header";
import { SettingsPanel } from "./SettingsPanel";
import { RecommendationList, FieldRecommendation } from "./RecommendationList";
import { generateRecommendations, FieldData } from "@/lib/api";
import { toast } from "sonner";

// Declare chrome as a global for TypeScript
declare const chrome: any;

// Check if we're running as a Chrome extension
const isExtension = typeof chrome !== 'undefined' && chrome?.runtime?.id;

// Simulated page data (used when not running as extension)
const MOCK_FIELDS: FieldData[] = [
  {
    fieldId: "name",
    fieldName: "Name",
    currentValue: "Mongo db 8.2",
  },
  {
    fieldId: "provider",
    fieldName: "Provider",
    currentValue: "",
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
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true);
  const [recommendations, setRecommendations] = useState<FieldRecommendation[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pageContext, setPageContext] = useState("LeanIX IT Component");

  // Load fields from the page on mount
  useEffect(() => {
    loadPageFields();
  }, []);

  const loadPageFields = async () => {
    if (isExtension) {
      try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab?.id) {
          // Send message to content script
          chrome.tabs.sendMessage(tab.id, { action: 'getPageData' }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('Error getting page data:', chrome.runtime.lastError);
              // Use mock data as fallback
              setRecommendations(MOCK_FIELDS.map(f => ({ ...f, isLoading: false })));
              return;
            }
            
            if (response && response.fields && response.fields.length > 0) {
              setPageContext(response.pageContext || "LeanIX IT Component");
              setRecommendations(response.fields.map((f: FieldData) => ({ ...f, isLoading: false })));
            } else {
              // No fields found, use mock data
              setRecommendations(MOCK_FIELDS.map(f => ({ ...f, isLoading: false })));
            }
          });
        }
      } catch (error) {
        console.error('Error loading page fields:', error);
        setRecommendations(MOCK_FIELDS.map(f => ({ ...f, isLoading: false })));
      }
    } else {
      // Not running as extension, use mock data
      setRecommendations(MOCK_FIELDS.map(f => ({ ...f, isLoading: false })));
    }
  };

  const handleGenerateRecommendations = async () => {
    console.log('Generate recommendations clicked!');
    setIsAnalyzing(true);
    
    // Set all fields to loading
    setRecommendations(prev => prev.map(r => ({ ...r, isLoading: true, recommendation: undefined })));

    try {
      const fieldsToAnalyze = recommendations.map(r => ({
        fieldId: r.fieldId,
        fieldName: r.fieldName,
        currentValue: r.currentValue,
      }));

      const results = await generateRecommendations(fieldsToAnalyze, pageContext);

      // Map results back to our format
      const updatedRecommendations: FieldRecommendation[] = recommendations.map(field => {
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

  const handleApply = async (fieldId: string, value: string) => {
    console.log('Applying recommendation:', fieldId, value);
    
    if (isExtension) {
      try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab?.id) {
          // Send message to content script to apply the value
          chrome.tabs.sendMessage(
            tab.id, 
            { action: 'applyRecommendation', fieldId, value },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('Error applying value:', chrome.runtime.lastError);
                toast.error(`Failed to apply: ${chrome.runtime.lastError.message}`);
                return;
              }
              
              if (response?.success) {
                toast.success(`Applied recommendation to ${fieldId}`);
                // Update local state
                setRecommendations(prev =>
                  prev.map(r =>
                    r.fieldId === fieldId
                      ? { ...r, currentValue: value }
                      : r
                  )
                );
              } else {
                toast.error(`Failed to apply: ${response?.error || 'Unknown error'}`);
              }
            }
          );
        }
      } catch (error) {
        console.error('Error applying recommendation:', error);
        toast.error("Failed to apply recommendation");
      }
    } else {
      // Not running as extension, just update local state
      toast.success(`Applied recommendation to ${fieldId}`);
      setRecommendations(prev =>
        prev.map(r =>
          r.fieldId === fieldId
            ? { ...r, currentValue: value }
            : r
        )
      );
    }
  };

  return (
    <div className="extension-popup flex flex-col bg-background overflow-hidden rounded-lg border border-border shadow-lg">
      {showSettings ? (
        <SettingsPanel
          onBack={() => setShowSettings(false)}
          apiKey=""
          onSaveApiKey={() => {}}
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
