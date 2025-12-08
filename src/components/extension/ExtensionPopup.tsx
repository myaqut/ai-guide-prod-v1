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
  const [approvedComponentName, setApprovedComponentName] = useState<string | null>(null);

  // Generate recommendation for a single field
  const generateSingleFieldRecommendation = useCallback(async (field: FieldData) => {
    console.log('[ExtensionPopup] Generating recommendation for field:', field.fieldName, 'with component:', approvedComponentName);
    
    // Set this field to loading
    setRecommendations(prev => 
      prev.map(r => r.fieldId === field.fieldId ? { ...r, isLoading: true } : r)
    );

    try {
      // Pass the approved component name to anchor the search
      const results = await generateRecommendations([field], pageContext, approvedComponentName || undefined);
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
  }, [pageContext, approvedComponentName]);

  // Handle active field change from content script - fetch recommendation for that field only
  const handleActiveFieldChange = useCallback((field: FieldData) => {
    console.log('[ExtensionPopup] Active field changed:', field.fieldName, field.fieldId);
    
    // Always update active field ID
    setActiveFieldId(field.fieldId);
    
    // Use functional update to get latest state
    setRecommendations(prev => {
      const existingIndex = prev.findIndex(r => r.fieldId === field.fieldId);
      
      if (existingIndex >= 0) {
        // Field exists - move to top and update current value
        const existing = prev[existingIndex];
        const updated = prev.filter(r => r.fieldId !== field.fieldId);
        const updatedField = { ...existing, currentValue: field.currentValue };
        
        // Schedule recommendation generation if needed (outside of setState)
        if (!existing.recommendation && !existing.isLoading) {
          setTimeout(() => generateSingleFieldRecommendation(field), 0);
        }
        
        return [updatedField, ...updated];
      } else {
        // New field - add at top with loading state
        const newField: FieldRecommendation = { 
          ...field, 
          isLoading: true 
        };
        
        // Schedule recommendation generation (outside of setState)
        setTimeout(() => generateSingleFieldRecommendation(field), 0);
        
        return [newField, ...prev];
      }
    });
    
    toast.info(`Field detected: ${field.fieldName}`, { duration: 2000 });
  }, [generateSingleFieldRecommendation]);

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
              // Start with just the Name field from mock
              const nameField = MOCK_FIELDS.find(f => f.fieldName.toLowerCase() === 'name');
              if (nameField) {
                setRecommendations([{ ...nameField, isLoading: false }]);
                if (nameField.currentValue) {
                  setApprovedComponentName(nameField.currentValue);
                }
              }
              return;
            }
            
            if (response && response.fields && response.fields.length > 0) {
              setPageContext(response.pageContext || "LeanIX IT Component");
              // Only start with the Name field - other fields will be added as they become active
              const nameField = response.fields.find((f: FieldData) => f.fieldName?.toLowerCase() === 'name');
              if (nameField) {
                setRecommendations([{ ...nameField, isLoading: false }]);
                if (nameField.currentValue) {
                  console.log('[ExtensionPopup] Initializing approved component name:', nameField.currentValue);
                  setApprovedComponentName(nameField.currentValue);
                }
              } else {
                // No name field found, start empty
                setRecommendations([]);
              }
            } else {
              // No fields found, use mock Name field
              const nameField = MOCK_FIELDS.find(f => f.fieldName.toLowerCase() === 'name');
              if (nameField) {
                setRecommendations([{ ...nameField, isLoading: false }]);
                if (nameField.currentValue) {
                  setApprovedComponentName(nameField.currentValue);
                }
              }
            }
          });
        }
      } catch (error) {
        console.error('Error loading page fields:', error);
        const nameField = MOCK_FIELDS.find(f => f.fieldName.toLowerCase() === 'name');
        if (nameField) {
          setRecommendations([{ ...nameField, isLoading: false }]);
        }
      }
    } else {
      // Not running as extension, start with just the Name field from mock
      const nameField = MOCK_FIELDS.find(f => f.fieldName.toLowerCase() === 'name');
      if (nameField) {
        setRecommendations([{ ...nameField, isLoading: false }]);
        if (nameField.currentValue) {
          setApprovedComponentName(nameField.currentValue);
        }
      }
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

      // Pass the approved component name to anchor all searches
      const results = await generateRecommendations(fieldsToAnalyze, pageContext, approvedComponentName || undefined);

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
    
    // Check if this is the Name field being applied - use it as the approved component name
    const field = recommendations.find(r => r.fieldId === fieldId);
    if (field?.fieldName?.toLowerCase() === 'name' && value) {
      console.log('[ExtensionPopup] Setting approved component name:', value);
      setApprovedComponentName(value);
    }
    
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

  const handleEditValue = (fieldId: string, value: string) => {
    console.log('[ExtensionPopup] Manual edit - updating field value:', fieldId, value);
    setRecommendations(prev =>
      prev.map(r =>
        r.fieldId === fieldId
          ? { ...r, recommendation: value }
          : r
      )
    );
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
            onEditValue={handleEditValue}
            activeFieldId={activeFieldId}
          />
        </>
      )}
    </div>
  );
};
