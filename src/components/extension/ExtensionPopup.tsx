import { useState, useEffect, useCallback } from "react";
import { Header } from "./Header";
import { SettingsPanel } from "./SettingsPanel";
import { RecommendationList, FieldRecommendation } from "./RecommendationList";
import { generateRecommendations, FieldData, GenerateRecommendationsResult } from "@/lib/api";
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
    currentValue: "Google Angular 20.0",
  },
];

// Check if name matches the expected format: Provider + Product + Version
// Examples: "MongoDB Community Server 8.2", "Google Angular 20.0", "Microsoft SQL Server 2022"
function isValidComponentNameFormat(name: string): boolean {
  if (!name || name.trim().length < 3) return false;
  
  // Should have at least 2 parts (provider/product and version)
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return false;
  
  // Check if last part looks like a version (contains number)
  const lastPart = parts[parts.length - 1];
  const hasVersion = /\d/.test(lastPart);
  
  // Check if first part looks like a provider name (capitalized)
  const firstPart = parts[0];
  const hasProvider = /^[A-Z]/.test(firstPart);
  
  return hasVersion && hasProvider;
}

export const ExtensionPopup = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true);
  const [recommendations, setRecommendations] = useState<FieldRecommendation[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pageContext, setPageContext] = useState("LeanIX IT Component");
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [approvedComponentName, setApprovedComponentName] = useState<string | null>(null);
  const [nameFieldStatus, setNameFieldStatus] = useState<'pending' | 'valid' | 'invalid'>('pending');
  const [urlCache, setUrlCache] = useState<Record<string, string[]>>({});

  // Generate recommendation for a single field
  const generateSingleFieldRecommendation = useCallback(async (field: FieldData) => {
    console.log('[ExtensionPopup] Generating recommendation for field:', field.fieldName, 'with component:', approvedComponentName);
    console.log('[ExtensionPopup] Current URL cache:', urlCache);
    
    // Set this field to loading
    setRecommendations(prev => 
      prev.map(r => r.fieldId === field.fieldId ? { ...r, isLoading: true } : r)
    );

    try {
      // Pass the approved component name and cached URLs to anchor the search
      const result = await generateRecommendations([field], pageContext, approvedComponentName || undefined, urlCache);
      const rec = result.recommendations.find(r => r.fieldId === field.fieldId);
      
      // Update URL cache if new URLs were returned
      if (result.cachedUrls) {
        setUrlCache(prev => ({ ...prev, ...result.cachedUrls }));
        console.log('[ExtensionPopup] Updated URL cache:', result.cachedUrls);
      }
      
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
  }, [pageContext, approvedComponentName, urlCache]);

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

  // Load Name field from the page on mount - this is the entry point
  useEffect(() => {
    loadNameField();
  }, []);

  const loadNameField = async () => {
    if (isExtension) {
      try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab?.id) {
          // Send message to content script to get specifically the Name field
          chrome.tabs.sendMessage(tab.id, { action: 'getNameField' }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('Error getting name field:', chrome.runtime.lastError);
              initializeWithMockName();
              return;
            }
            
            if (response && response.field) {
              const nameField = response.field;
              setPageContext(response.pageContext || "LeanIX IT Component");
              processNameField(nameField);
            } else {
              initializeWithMockName();
            }
          });
        }
      } catch (error) {
        console.error('Error loading name field:', error);
        initializeWithMockName();
      }
    } else {
      // Not running as extension, use mock
      initializeWithMockName();
    }
  };

  const initializeWithMockName = () => {
    const nameField = MOCK_FIELDS.find(f => f.fieldName.toLowerCase() === 'name');
    if (nameField) {
      processNameField(nameField);
    }
  };

  const processNameField = (nameField: FieldData) => {
    console.log('[ExtensionPopup] Processing Name field:', nameField);
    
    const currentName = nameField.currentValue || '';
    const isValid = isValidComponentNameFormat(currentName);
    
    setNameFieldStatus(isValid ? 'valid' : (currentName ? 'invalid' : 'pending'));
    
    if (isValid) {
      // Name is valid - auto-approve and use as anchor
      console.log('[ExtensionPopup] Name format valid, auto-approving:', currentName);
      setApprovedComponentName(currentName);
      setRecommendations([{ 
        ...nameField, 
        recommendation: currentName,
        confidence: 1,
        reasoning: 'Name already matches the expected format: [Provider] + [Product] + [Version]',
        isLoading: false 
      }]);
      toast.success(`Component identified: ${currentName}`);
    } else if (currentName) {
      // Name exists but doesn't match format - show for correction
      console.log('[ExtensionPopup] Name format invalid, needs correction:', currentName);
      setRecommendations([{ 
        ...nameField, 
        isLoading: true 
      }]);
      // Generate AI recommendation for proper name format
      generateSingleFieldRecommendation(nameField);
      toast.info('Name field needs formatting correction');
    } else {
      // No name - show empty field for input
      console.log('[ExtensionPopup] No name found, waiting for input');
      setRecommendations([{ 
        ...nameField, 
        isLoading: false 
      }]);
      toast.info('Please enter or focus the Name field to start');
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

      // Pass the approved component name and cached URLs to anchor all searches
      const result = await generateRecommendations(fieldsToAnalyze, pageContext, approvedComponentName || undefined, urlCache);

      // Update URL cache if new URLs were returned
      if (result.cachedUrls) {
        setUrlCache(prev => ({ ...prev, ...result.cachedUrls }));
      }

      // Map results back to our format
      const updatedRecommendations: FieldRecommendation[] = recommendations.map(field => {
        const rec = result.recommendations.find(r => r.fieldId === field.fieldId);
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
    
    // Check if this is the Name field being applied
    const field = recommendations.find(r => r.fieldId === fieldId);
    if (field?.fieldName?.toLowerCase() === 'name' && value) {
      // Validate the name format
      if (isValidComponentNameFormat(value)) {
        console.log('[ExtensionPopup] Name format valid, setting approved component name:', value);
        setApprovedComponentName(value);
        setNameFieldStatus('valid');
        toast.success(`Component name approved: ${value}`);
      } else {
        console.log('[ExtensionPopup] Name format invalid:', value);
        setNameFieldStatus('invalid');
        toast.warning('Name format should be: [Provider] + [Product] + [Version]');
      }
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

  const handleRemoveField = (fieldId: string) => {
    setRecommendations(prev => prev.filter(r => r.fieldId !== fieldId));
    toast.info("Field removed");
  };

  const handleStartOver = () => {
    setRecommendations([]);
    setApprovedComponentName(null);
    setActiveFieldId(null);
    setNameFieldStatus('pending');
    setUrlCache({}); // Clear URL cache when starting over
    // Reload name field from page
    loadNameField();
    toast.success("Starting over - Name field reloaded");
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
            onStartOver={handleStartOver}
            isConnected={apiKeyConfigured}
          />
          <RecommendationList
            recommendations={recommendations}
            isAnalyzing={isAnalyzing}
            onRefresh={handleGenerateRecommendations}
            onRefreshField={handleRefreshField}
            onApply={handleApply}
            onEditValue={handleEditValue}
            onRemoveField={handleRemoveField}
            activeFieldId={activeFieldId}
          />
        </>
      )}
    </div>
  );
};
