import { useState, useEffect, useCallback } from "react";
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
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  // Generate recommendation for a single field
  const generateSingleFieldRecommendation = useCallback(async (field: FieldData) => {
    console.log('[ExtensionPopup] Generating recommendation for field:', field.fieldName);
    
    // Set this field to loading
    setRecommendations(prev => 
      prev.map(r => r.fieldId === field.fieldId ? { ...r, isLoading: true } : r)
    );

    try {
      const results = await generateRecommendations([field], pageContext);
      const rec = results.find(r => r.fieldId === field.fieldId);
      
      setRecommendations(prev => 
        prev.map(r => r.fieldId === field.fieldId 
          ? { 
              ...r, 
              recommendation: rec?.recommendation,
              confidence: rec?.confidence,
              reasoning: rec?.reasoning,
              isLoading: false 
            } 
          : r
        )
      );
      
      if (rec?.recommendation) {
        toast.success(`Recommendation ready for ${field.fieldName}`);
      }
    } catch (error) {
      console.error('Error generating recommendation for field:', field.fieldId, error);
      setRecommendations(prev => 
        prev.map(r => r.fieldId === field.fieldId ? { ...r, isLoading: false } : r)
      );
      toast.error(`Failed to get recommendation for ${field.fieldName}`);
    }
  }, [pageContext]);

  // Handle active field change from content script - fetch recommendation for that field only
  const handleActiveFieldChange = useCallback((field: FieldData) => {
    console.log('[ExtensionPopup] Active field changed:', field);
    setActiveFieldId(field.fieldId);
    
    // Check if field already exists in recommendations
    const existingField = recommendations.find(r => r.fieldId === field.fieldId);
    
    if (existingField) {
      // Move to top and update current value
      setRecommendations(prev => {
        const updated = prev.filter(r => r.fieldId !== field.fieldId);
        return [{ ...existingField, currentValue: field.currentValue }, ...updated];
      });
      
      // Only auto-generate if no recommendation exists yet
      if (!existingField.recommendation && !existingField.isLoading) {
        generateSingleFieldRecommendation(field);
      }
    } else {
      // Add new field at the top and auto-generate
      const newField = { ...field, isLoading: true };
      setRecommendations(prev => [newField, ...prev]);
      generateSingleFieldRecommendation(field);
    }
    
    toast.info(`Field detected: ${field.fieldName}`, { duration: 2000 });
  }, [recommendations, generateSingleFieldRecommendation]);

  // Handle refresh for a single field
  const handleRefreshField = useCallback((fieldId: string) => {
    const field = recommendations.find(r => r.fieldId === fieldId);
    if (field) {
      generateSingleFieldRecommendation({
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        currentValue: field.currentValue,
      });
    }
  }, [recommendations, generateSingleFieldRecommendation]);

  // Listen for messages from content script via background worker
  useEffect(() => {
    if (!isExtension) return;

    const messageListener = (message: any) => {
      if (message.action === 'activeFieldChanged' && message.field) {
        handleActiveFieldChange(message.field);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [handleActiveFieldChange]);

  // Load fields from the page on mount - just load field list, don't fetch recommendations
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
              // Use mock data as fallback - no auto-fetch
              setRecommendations(MOCK_FIELDS.map(f => ({ ...f, isLoading: false })));
              return;
            }
            
            if (response && response.fields && response.fields.length > 0) {
              setPageContext(response.pageContext || "LeanIX IT Component");
              // Just load fields without recommendations - they'll be fetched on click
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
      // Not running as extension, use mock data - no auto-fetch
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
            onRefreshField={handleRefreshField}
            onApply={handleApply}
            activeFieldId={activeFieldId}
          />
        </>
      )}
    </div>
  );
};
