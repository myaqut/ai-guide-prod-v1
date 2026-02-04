import { useState, useEffect, useCallback } from "react";
import { Header } from "./Header";
import { SettingsPanel } from "./SettingsPanel";
import { RecommendationList, FieldRecommendation } from "./RecommendationList";
import { WorkflowSelector, WorkflowType } from "./WorkflowSelector";
import { EntryForm } from "./EntryForm";
import { PerplexityChat } from "./PerplexityChat";
import { generateRecommendations, FieldData, GenerateRecommendationsResult } from "@/lib/api";
import { isValidNameFormat, getPageContext, getNameFormatGuidance, getWorkflowLabel } from "@/lib/workflow-config";
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

export const ExtensionPopup = () => {
  const [workflowType, setWorkflowType] = useState<WorkflowType | null>(null);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true);
  const [recommendations, setRecommendations] = useState<FieldRecommendation[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pageContext, setPageContext] = useState("LeanIX IT Component");
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [approvedComponentName, setApprovedComponentName] = useState<string | null>(null);
  const [productUrl, setProductUrl] = useState<string | undefined>(undefined);
  const [nameFieldStatus, setNameFieldStatus] = useState<'pending' | 'valid' | 'invalid'>('pending');
  const [urlCache, setUrlCache] = useState<Record<string, string[]>>({});

  // Handle workflow selection - show entry form next (or chat directly)
  const handleWorkflowSelect = (workflow: WorkflowType) => {
    setWorkflowType(workflow);
    setPageContext(getPageContext(workflow));
    
    // For chat workflow, don't show entry form
    if (workflow === 'chat') {
      setShowEntryForm(false);
      toast.success('Research Chat ready');
    } else {
      setShowEntryForm(true);
      toast.success(`${getWorkflowLabel(workflow)} workflow selected`);
    }
  };

  // Handle entry form submission - now we have name and optional URL
  const handleEntrySubmit = (name: string, url?: string) => {
    console.log('[ExtensionPopup] Entry submitted - Name:', name, 'URL:', url);
    setApprovedComponentName(name);
    setProductUrl(url);
    setNameFieldStatus('valid');
    setShowEntryForm(false);
    
    // Initialize with the name field already set
    const nameField: FieldRecommendation = {
      fieldId: 'name',
      fieldName: 'Name',
      currentValue: name,
      recommendation: name,
      confidence: 1,
      reasoning: 'Name provided by user at start of cataloging process',
      isLoading: false
    };
    setRecommendations([nameField]);
    
    const entityLabel = workflowType === 'application' ? 'Application' : 'Component';
    toast.success(`${entityLabel} identified: ${name}`);
  };

  // Check if name matches the expected format based on workflow
  const isValidComponentNameFormat = (name: string): boolean => {
    if (!workflowType) return false;
    return isValidNameFormat(name, workflowType);
  };

  // Generate recommendation for a single field
  const generateSingleFieldRecommendation = useCallback(async (field: FieldData) => {
    if (!workflowType) return;
    
    console.log('[ExtensionPopup] Generating recommendation for field:', field.fieldName, 'with component:', approvedComponentName);
    console.log('[ExtensionPopup] Current URL cache:', urlCache);
    
    // Set this field to loading
    setRecommendations(prev => 
      prev.map(r => r.fieldId === field.fieldId ? { ...r, isLoading: true } : r)
    );

    try {
      // Pass the approved component name, cached URLs, and product URL to anchor the search
      const result = await generateRecommendations([field], pageContext, approvedComponentName || undefined, urlCache, workflowType, productUrl);
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
  }, [pageContext, approvedComponentName, urlCache, workflowType, productUrl]);

  // Handle active field change from content script - fetch recommendation for that field only
  const handleActiveFieldChange = useCallback((field: FieldData) => {
    console.log('[ExtensionPopup] Active field changed:', field.fieldName, field.fieldId);
    
    // Always update active field ID
    setActiveFieldId(field.fieldId);
    
    // CRITICAL: Don't generate recommendations until Name field is approved (unless this IS the Name field)
    const isNameField = field.fieldName?.toLowerCase() === 'name';
    
    // Use functional update to get latest state
    setRecommendations(prev => {
      const existingIndex = prev.findIndex(r => r.fieldId === field.fieldId);
      
      if (existingIndex >= 0) {
        // Field exists - move to top and update current value
        const existing = prev[existingIndex];
        const updated = prev.filter(r => r.fieldId !== field.fieldId);
        const updatedField = { ...existing, currentValue: field.currentValue };
        
        // Schedule recommendation generation if needed (outside of setState)
        // Only generate if Name is approved OR this is the Name field
        if (!existing.recommendation && !existing.isLoading) {
          if (approvedComponentName || isNameField) {
            setTimeout(() => generateSingleFieldRecommendation(field), 0);
          } else {
            console.log('[ExtensionPopup] Skipping recommendation - Name field not yet approved');
          }
        }
        
        return [updatedField, ...updated];
      } else {
        // New field - add at top
        // Only set loading if we're actually going to generate
        const shouldGenerate = !!(approvedComponentName || isNameField);
        const newField: FieldRecommendation = { 
          ...field, 
          isLoading: shouldGenerate
        };
        
        // Schedule recommendation generation (outside of setState)
        if (shouldGenerate) {
          setTimeout(() => generateSingleFieldRecommendation(field), 0);
        } else {
          console.log('[ExtensionPopup] Skipping recommendation - Name field not yet approved');
        }
        
        return [newField, ...prev];
      }
    });
    
    toast.info(`Field detected: ${field.fieldName}`, { duration: 2000 });
  }, [generateSingleFieldRecommendation, approvedComponentName]);

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

  const loadNameField = async () => {
    // CRITICAL: Clear all previous state before loading new Name field
    setRecommendations([]);
    setApprovedComponentName(null);
    setNameFieldStatus('pending');
    setUrlCache({});
    setActiveFieldId(null);
    
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
              console.log('[ExtensionPopup] Received Name field from page:', nameField);
              processNameField(nameField);
            } else {
              console.log('[ExtensionPopup] No Name field found on page');
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
      const guidance = workflowType ? getNameFormatGuidance(workflowType) : 'Name already matches the expected format';
      setRecommendations([{ 
        ...nameField, 
        recommendation: currentName,
        confidence: 1,
        reasoning: `Name already matches the expected format: ${guidance}`,
        isLoading: false 
      }]);
      toast.success(`${workflowType === 'application' ? 'Application' : 'Component'} identified: ${currentName}`);
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
    if (!workflowType) return;
    
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

      // Pass the approved component name, cached URLs, and product URL to anchor all searches
      const result = await generateRecommendations(fieldsToAnalyze, pageContext, approvedComponentName || undefined, urlCache, workflowType, productUrl);

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
        toast.success(`${workflowType === 'application' ? 'Application' : 'Component'} name approved: ${value}`);
      } else {
        console.log('[ExtensionPopup] Name format invalid:', value);
        setNameFieldStatus('invalid');
        const guidance = workflowType ? getNameFormatGuidance(workflowType) : '[Provider] + [Product] + [Version]';
        toast.warning(`Name format should be: ${guidance}`);
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
    setWorkflowType(null);
    setShowEntryForm(false);
    setRecommendations([]);
    setApprovedComponentName(null);
    setProductUrl(undefined);
    setActiveFieldId(null);
    setNameFieldStatus('pending');
    setUrlCache({});
    toast.success("Starting over - select a workflow");
  };

  // Show workflow selector if no workflow is selected
  if (!workflowType) {
    return (
      <div className="extension-popup flex flex-col bg-background overflow-hidden rounded-lg border border-border shadow-lg">
        <WorkflowSelector onSelect={handleWorkflowSelect} />
      </div>
    );
  }

  // Show chat interface for Research Chat workflow
  if (workflowType === 'chat') {
    return (
      <PerplexityChat onBack={handleStartOver} />
    );
  }

  // Show entry form after workflow selection (ITC/Application only)
  if (showEntryForm) {
    return (
      <div className="extension-popup flex flex-col bg-background overflow-hidden rounded-lg border border-border shadow-lg">
        <EntryForm 
          workflowType={workflowType}
          onSubmit={handleEntrySubmit}
          onBack={() => {
            setWorkflowType(null);
            setShowEntryForm(false);
          }}
        />
      </div>
    );
  }

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
