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
import { Monitor, Cloud, Sparkles, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

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

// State interface for catalog workflows (ITC/Application)
interface CatalogWorkflowState {
  workflowType: 'itc' | 'application';
  showEntryForm: boolean;
  recommendations: FieldRecommendation[];
  isAnalyzing: boolean;
  pageContext: string;
  activeFieldId: string | null;
  approvedComponentName: string | null;
  productUrl: string | undefined;
  nameFieldStatus: 'pending' | 'valid' | 'invalid';
  urlCache: Record<string, string[]>;
}

export const ExtensionPopup = () => {
  // Active tab for switching between workflows
  const [activeTab, setActiveTab] = useState<'workflow' | 'catalog' | 'chat'>('workflow');
  
  // Current catalog workflow being set up (null means not selected yet)
  const [pendingCatalogWorkflow, setPendingCatalogWorkflow] = useState<'itc' | 'application' | null>(null);
  
  // Persisted catalog workflow state
  const [catalogState, setCatalogState] = useState<CatalogWorkflowState | null>(null);
  
  // Settings panel visibility
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true);

  // Convenience getters for catalog state
  const workflowType = catalogState?.workflowType ?? pendingCatalogWorkflow;
  const showEntryForm = catalogState?.showEntryForm ?? (pendingCatalogWorkflow !== null);
  const recommendations = catalogState?.recommendations ?? [];
  const isAnalyzing = catalogState?.isAnalyzing ?? false;
  const pageContext = catalogState?.pageContext ?? "LeanIX IT Component";
  const activeFieldId = catalogState?.activeFieldId ?? null;
  const approvedComponentName = catalogState?.approvedComponentName ?? null;
  const productUrl = catalogState?.productUrl;
  const nameFieldStatus = catalogState?.nameFieldStatus ?? 'pending';
  const urlCache = catalogState?.urlCache ?? {};

  // Update catalog state helper
  const updateCatalogState = (updates: Partial<CatalogWorkflowState>) => {
    setCatalogState(prev => prev ? { ...prev, ...updates } : null);
  };

  // Handle workflow selection from WorkflowSelector
  const handleWorkflowSelect = (workflow: WorkflowType) => {
    if (workflow === 'chat') {
      // Switch directly to chat tab
      setActiveTab('chat');
      toast.success('Research Chat ready');
    } else {
      // Set up catalog workflow
      setPendingCatalogWorkflow(workflow);
      setActiveTab('catalog');
      toast.success(`${getWorkflowLabel(workflow)} workflow selected`);
    }
  };

  // Handle entry form submission - now we have name and optional URL
  const handleEntrySubmit = (name: string, url?: string) => {
    console.log('[ExtensionPopup] Entry submitted - Name:', name, 'URL:', url);
    
    const workflow = pendingCatalogWorkflow!;
    
    // Initialize the name field
    const nameField: FieldRecommendation = {
      fieldId: 'name',
      fieldName: 'Name',
      currentValue: name,
      recommendation: name,
      confidence: 1,
      reasoning: 'Name provided by user at start of cataloging process',
      isLoading: false
    };
    
    // Create full catalog state
    setCatalogState({
      workflowType: workflow,
      showEntryForm: false,
      recommendations: [nameField],
      isAnalyzing: false,
      pageContext: getPageContext(workflow),
      activeFieldId: null,
      approvedComponentName: name,
      productUrl: url,
      nameFieldStatus: 'valid',
      urlCache: {},
    });
    
    // Clear pending workflow since it's now saved
    setPendingCatalogWorkflow(null);
    
    const entityLabel = workflow === 'application' ? 'Application' : 'Component';
    toast.success(`${entityLabel} identified: ${name}`);
  };

  // Check if name matches the expected format based on workflow
  const isValidComponentNameFormat = (name: string): boolean => {
    if (!workflowType) return false;
    return isValidNameFormat(name, workflowType);
  };

  // Generate recommendation for a single field
  const generateSingleFieldRecommendation = useCallback(async (field: FieldData) => {
    if (!catalogState) return;
    
    console.log('[ExtensionPopup] Generating recommendation for field:', field.fieldName, 'with component:', catalogState.approvedComponentName);
    console.log('[ExtensionPopup] Current URL cache:', catalogState.urlCache);
    
    // Set this field to loading
    updateCatalogState({
      recommendations: catalogState.recommendations.map(r => 
        r.fieldId === field.fieldId ? { ...r, isLoading: true } : r
      )
    });

    try {
      // Pass the approved component name, cached URLs, and product URL to anchor the search
      const result = await generateRecommendations(
        [field], 
        catalogState.pageContext, 
        catalogState.approvedComponentName || undefined, 
        catalogState.urlCache, 
        catalogState.workflowType, 
        catalogState.productUrl
      );
      const rec = result.recommendations.find(r => r.fieldId === field.fieldId);
      
      // Update URL cache if new URLs were returned
      const newUrlCache = result.cachedUrls 
        ? { ...catalogState.urlCache, ...result.cachedUrls }
        : catalogState.urlCache;
      
      if (result.cachedUrls) {
        console.log('[ExtensionPopup] Updated URL cache:', result.cachedUrls);
      }
      
      setCatalogState(prev => prev ? {
        ...prev,
        urlCache: newUrlCache,
        recommendations: prev.recommendations.map(r => 
          r.fieldId === field.fieldId 
            ? { 
                ...r, 
                recommendation: rec?.recommendation,
                confidence: rec?.confidence,
                reasoning: rec?.reasoning,
                isLoading: false 
              } 
            : r
        )
      } : null);
      
      if (rec?.recommendation) {
        toast.success(`Recommendation ready for ${field.fieldName}`);
      }
    } catch (error) {
      console.error('Error generating recommendation for field:', field.fieldId, error);
      setCatalogState(prev => prev ? {
        ...prev,
        recommendations: prev.recommendations.map(r => 
          r.fieldId === field.fieldId ? { ...r, isLoading: false } : r
        )
      } : null);
      toast.error(`Failed to get recommendation for ${field.fieldName}`);
    }
  }, [catalogState]);

  // Handle active field change from content script - fetch recommendation for that field only
  const handleActiveFieldChange = useCallback((field: FieldData) => {
    if (!catalogState) return;
    
    console.log('[ExtensionPopup] Active field changed:', field.fieldName, field.fieldId);
    
    const isNameField = field.fieldName?.toLowerCase() === 'name';
    
    setCatalogState(prev => {
      if (!prev) return null;
      
      const existingIndex = prev.recommendations.findIndex(r => r.fieldId === field.fieldId);
      
      if (existingIndex >= 0) {
        const existing = prev.recommendations[existingIndex];
        const updated = prev.recommendations.filter(r => r.fieldId !== field.fieldId);
        const updatedField = { ...existing, currentValue: field.currentValue };
        
        if (!existing.recommendation && !existing.isLoading) {
          if (prev.approvedComponentName || isNameField) {
            setTimeout(() => generateSingleFieldRecommendation(field), 0);
          }
        }
        
        return { ...prev, activeFieldId: field.fieldId, recommendations: [updatedField, ...updated] };
      } else {
        const shouldGenerate = !!(prev.approvedComponentName || isNameField);
        const newField: FieldRecommendation = { 
          ...field, 
          isLoading: shouldGenerate
        };
        
        if (shouldGenerate) {
          setTimeout(() => generateSingleFieldRecommendation(field), 0);
        }
        
        return { ...prev, activeFieldId: field.fieldId, recommendations: [newField, ...prev.recommendations] };
      }
    });
    
    toast.info(`Field detected: ${field.fieldName}`, { duration: 2000 });
  }, [catalogState, generateSingleFieldRecommendation]);

  // Handle refresh for a single field
  const handleRefreshField = useCallback((fieldId: string) => {
    if (!catalogState) return;
    const field = catalogState.recommendations.find(r => r.fieldId === fieldId);
    if (field) {
      generateSingleFieldRecommendation({
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        currentValue: field.currentValue,
      });
    }
  }, [catalogState, generateSingleFieldRecommendation]);

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

  const handleGenerateRecommendations = async () => {
    if (!catalogState) return;
    
    console.log('Generate recommendations clicked!');
    updateCatalogState({ isAnalyzing: true });
    
    // Set all fields to loading
    updateCatalogState({
      recommendations: catalogState.recommendations.map(r => ({ ...r, isLoading: true, recommendation: undefined }))
    });

    try {
      const fieldsToAnalyze = catalogState.recommendations.map(r => ({
        fieldId: r.fieldId,
        fieldName: r.fieldName,
        currentValue: r.currentValue,
      }));

      const result = await generateRecommendations(
        fieldsToAnalyze, 
        catalogState.pageContext, 
        catalogState.approvedComponentName || undefined, 
        catalogState.urlCache, 
        catalogState.workflowType, 
        catalogState.productUrl
      );

      const newUrlCache = result.cachedUrls 
        ? { ...catalogState.urlCache, ...result.cachedUrls }
        : catalogState.urlCache;

      const updatedRecommendations: FieldRecommendation[] = catalogState.recommendations.map(field => {
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

      setCatalogState(prev => prev ? {
        ...prev,
        isAnalyzing: false,
        urlCache: newUrlCache,
        recommendations: updatedRecommendations,
      } : null);
      
      toast.success("AI analysis complete!");
    } catch (error) {
      console.error('Error generating recommendations:', error);
      toast.error(error instanceof Error ? error.message : "Failed to generate recommendations");
      updateCatalogState({
        isAnalyzing: false,
        recommendations: catalogState.recommendations.map(r => ({ ...r, isLoading: false }))
      });
    }
  };

  const handleApply = async (fieldId: string, value: string) => {
    if (!catalogState) return;
    
    console.log('Applying recommendation:', fieldId, value);
    
    const field = catalogState.recommendations.find(r => r.fieldId === fieldId);
    if (field?.fieldName?.toLowerCase() === 'name' && value) {
      if (isValidComponentNameFormat(value)) {
        console.log('[ExtensionPopup] Name format valid, setting approved component name:', value);
        updateCatalogState({ 
          approvedComponentName: value,
          nameFieldStatus: 'valid'
        });
        toast.success(`${catalogState.workflowType === 'application' ? 'Application' : 'Component'} name approved: ${value}`);
      } else {
        console.log('[ExtensionPopup] Name format invalid:', value);
        updateCatalogState({ nameFieldStatus: 'invalid' });
        const guidance = getNameFormatGuidance(catalogState.workflowType);
        toast.warning(`Name format should be: ${guidance}`);
      }
    }
    
    if (isExtension) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab?.id) {
          chrome.tabs.sendMessage(
            tab.id, 
            { action: 'applyRecommendation', fieldId, value },
            (response: any) => {
              if (chrome.runtime.lastError) {
                console.error('Error applying value:', chrome.runtime.lastError);
                toast.error(`Failed to apply: ${chrome.runtime.lastError.message}`);
                return;
              }
              
              if (response?.success) {
                toast.success(`Applied recommendation to ${fieldId}`);
                setCatalogState(prev => prev ? {
                  ...prev,
                  recommendations: prev.recommendations.map(r =>
                    r.fieldId === fieldId ? { ...r, currentValue: value } : r
                  )
                } : null);
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
      toast.success(`Applied recommendation to ${fieldId}`);
      setCatalogState(prev => prev ? {
        ...prev,
        recommendations: prev.recommendations.map(r =>
          r.fieldId === fieldId ? { ...r, currentValue: value } : r
        )
      } : null);
    }
  };

  const handleEditValue = (fieldId: string, value: string) => {
    console.log('[ExtensionPopup] Manual edit - updating field value:', fieldId, value);
    setCatalogState(prev => prev ? {
      ...prev,
      recommendations: prev.recommendations.map(r =>
        r.fieldId === fieldId ? { ...r, recommendation: value } : r
      )
    } : null);
  };

  const handleRemoveField = (fieldId: string) => {
    setCatalogState(prev => prev ? {
      ...prev,
      recommendations: prev.recommendations.filter(r => r.fieldId !== fieldId)
    } : null);
    toast.info("Field removed");
  };

  const handleStartOver = () => {
    setCatalogState(null);
    setPendingCatalogWorkflow(null);
    setActiveTab('workflow');
    toast.success("Starting over - select a workflow");
  };

  const handleBackFromEntry = () => {
    setPendingCatalogWorkflow(null);
    setActiveTab('workflow');
  };

  // Determine if we have an active catalog session
  const hasCatalogSession = catalogState !== null;
  
  // Show tabs only when we have at least one active workflow
  const showBottomTabs = hasCatalogSession || activeTab === 'chat';

  // Render content based on active tab
  const renderContent = () => {
    // Workflow selector (initial state or when explicitly on workflow tab without sessions)
    if (activeTab === 'workflow' && !hasCatalogSession) {
      return <WorkflowSelector onSelect={handleWorkflowSelect} />;
    }
    
    // Research Chat tab - use embedded mode when tabs are visible
    if (activeTab === 'chat') {
      return (
        <PerplexityChat 
          embedded={showBottomTabs}
          onBack={!showBottomTabs ? () => setActiveTab(hasCatalogSession ? 'catalog' : 'workflow') : undefined} 
        />
      );
    }
    
    // Catalog tab - show entry form if pending workflow
    if (activeTab === 'catalog') {
      // If we're setting up a new catalog workflow
      if (pendingCatalogWorkflow && !catalogState) {
        return (
          <EntryForm 
            workflowType={pendingCatalogWorkflow}
            onSubmit={handleEntrySubmit}
            onBack={handleBackFromEntry}
          />
        );
      }
      
      // Show active catalog workflow
      if (catalogState) {
        if (showSettings) {
          return (
            <SettingsPanel
              onBack={() => setShowSettings(false)}
              apiKey=""
              onSaveApiKey={() => {}}
            />
          );
        }
        
        return (
          <>
            <Header
              onSettingsClick={() => setShowSettings(true)}
              onStartOver={handleStartOver}
              isConnected={apiKeyConfigured}
            />
            <RecommendationList
              recommendations={catalogState.recommendations}
              isAnalyzing={catalogState.isAnalyzing}
              onRefresh={handleGenerateRecommendations}
              onRefreshField={handleRefreshField}
              onApply={handleApply}
              onEditValue={handleEditValue}
              onRemoveField={handleRemoveField}
              activeFieldId={catalogState.activeFieldId}
            />
          </>
        );
      }
    }
    
    // Default - show workflow selector
    return <WorkflowSelector onSelect={handleWorkflowSelect} />;
  };

  // Get tab label for catalog workflow
  const getCatalogTabLabel = () => {
    if (catalogState) {
      return catalogState.workflowType === 'itc' ? 'IT Component' : 'Application';
    }
    if (pendingCatalogWorkflow) {
      return pendingCatalogWorkflow === 'itc' ? 'IT Component' : 'Application';
    }
    return 'Catalog';
  };

  const getCatalogTabIcon = () => {
    const type = catalogState?.workflowType ?? pendingCatalogWorkflow;
    if (type === 'application') {
      return <Cloud className="h-4 w-4" />;
    }
    return <Monitor className="h-4 w-4" />;
  };

  // Chrome-style tab component
  const ChromeTab = ({ 
    active, 
    icon, 
    label, 
    onClick, 
    onClose 
  }: { 
    active: boolean; 
    icon: React.ReactNode; 
    label: string; 
    onClick: () => void;
    onClose?: () => void;
  }) => (
    <div 
      className={cn(
        "relative flex items-center gap-2 px-3 py-2 cursor-pointer transition-all duration-150 group min-w-[100px] max-w-[180px]",
        "rounded-t-lg border-x border-t",
        active 
          ? "bg-background border-border z-10 -mb-px" 
          : "bg-muted/50 border-transparent hover:bg-muted/80"
      )}
      onClick={onClick}
    >
      <span className={cn(
        "transition-colors",
        active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
      )}>
        {icon}
      </span>
      <span className={cn(
        "text-xs font-medium truncate flex-1",
        active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
      )}>
        {label}
      </span>
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "p-0.5 rounded-sm transition-colors",
            "opacity-0 group-hover:opacity-100",
            active && "opacity-100",
            "hover:bg-muted-foreground/20"
          )}
        >
          <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
        </button>
      )}
      {/* Active tab connector line */}
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-px bg-background" />
      )}
    </div>
  );

  // New tab button
  const NewTabButton = ({ onClick }: { onClick: () => void }) => (
    <button
      onClick={onClick}
      className="p-2 rounded-md hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
      title="New workflow"
    >
      <Plus className="h-4 w-4" />
    </button>
  );

  return (
    <div className="extension-popup flex flex-col bg-background overflow-hidden rounded-lg border border-border shadow-lg">
      {/* Chrome-style tab bar at top when we have active sessions */}
      {showBottomTabs && (
        <div className="flex items-end gap-0.5 px-2 pt-2 bg-muted/30 border-b border-border">
          {(hasCatalogSession || pendingCatalogWorkflow) && (
            <ChromeTab
              active={activeTab === 'catalog'}
              icon={getCatalogTabIcon()}
              label={getCatalogTabLabel()}
              onClick={() => setActiveTab('catalog')}
              onClose={handleStartOver}
            />
          )}
          <ChromeTab
            active={activeTab === 'chat'}
            icon={<Sparkles className="h-4 w-4" />}
            label="Research Chat"
            onClick={() => setActiveTab('chat')}
          />
          {/* New tab button - only when not all workflows are open */}
          {!hasCatalogSession && activeTab !== 'workflow' && (
            <NewTabButton onClick={() => setActiveTab('workflow')} />
          )}
        </div>
      )}
      
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {renderContent()}
      </div>
    </div>
  );
};
