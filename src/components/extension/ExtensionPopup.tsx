import { useState, useEffect, useCallback } from "react";
import { Header } from "./Header";
import { SettingsPanel } from "./SettingsPanel";
import { RecommendationList, FieldRecommendation } from "./RecommendationList";
import { WorkflowSelector, WorkflowType } from "./WorkflowSelector";
import { EntryForm } from "./EntryForm";
import { PerplexityChat, ChatMessage } from "./PerplexityChat";
import { AuthScreen } from "./AuthScreen";
import { generateRecommendations, FieldData, GenerateRecommendationsResult } from "@/lib/api";
import { isValidNameFormat, getPageContext, getNameFormatGuidance, getWorkflowLabel } from "@/lib/workflow-config";
 import { getFieldsForWorkflow } from "@/lib/workflow-config";
import { toast } from "sonner";
import { Monitor, Cloud, Sparkles, X, Plus, Loader2 } from "lucide-react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

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

// State interface for catalog workflows (ITC/Application/Provider)
interface CatalogWorkflowState {
  workflowType: 'itc' | 'application' | 'provider';
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
  // Auth temporarily disabled for testing
  // const { user, isLoading: authLoading } = useAuth();
  const user = true; // Bypass auth
  const authLoading = false;
  
  // Active tab for switching between workflows
  const [activeTab, setActiveTab] = useState<'workflow' | 'itc' | 'application' | 'provider' | 'chat'>('workflow');
  
  // Current catalog workflow being set up (null means not selected yet)
  const [pendingCatalogWorkflow, setPendingCatalogWorkflow] = useState<'itc' | 'application' | 'provider' | null>(null);
  
  // Separate persisted states for ITC, Application, and Provider workflows
  const [itcState, setItcState] = useState<CatalogWorkflowState | null>(null);
  const [applicationState, setApplicationState] = useState<CatalogWorkflowState | null>(null);
  const [providerState, setProviderState] = useState<CatalogWorkflowState | null>(null);
  
  // Chat tab visibility (can be closed and reopened)
  const [showChatTab, setShowChatTab] = useState(false);
  
  // Persistent chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatDomainFilter, setChatDomainFilter] = useState("");
  
  // Settings panel visibility
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true);

  // Get the active catalog state based on current tab
  const getActiveCatalogState = (): CatalogWorkflowState | null => {
    if (activeTab === 'itc') return itcState;
    if (activeTab === 'application') return applicationState;
    if (activeTab === 'provider') return providerState;
    return null;
  };

  // Set the active catalog state based on workflow type
  const setActiveCatalogState = (workflowType: 'itc' | 'application' | 'provider', state: CatalogWorkflowState | null) => {
    if (workflowType === 'itc') {
      setItcState(state);
    } else if (workflowType === 'application') {
      setApplicationState(state);
    } else {
      setProviderState(state);
    }
  };

  const catalogState = getActiveCatalogState();

  // Convenience getters for catalog state
  const workflowType = catalogState?.workflowType ?? pendingCatalogWorkflow;
  const recommendations = catalogState?.recommendations ?? [];
  const isAnalyzing = catalogState?.isAnalyzing ?? false;
  const pageContext = catalogState?.pageContext ?? "LeanIX IT Component";
  const activeFieldId = catalogState?.activeFieldId ?? null;
  const approvedComponentName = catalogState?.approvedComponentName ?? null;
  const productUrl = catalogState?.productUrl;
  const nameFieldStatus = catalogState?.nameFieldStatus ?? 'pending';
  const urlCache = catalogState?.urlCache ?? {};

  // Update catalog state helper - updates the correct state based on workflow type
  const updateCatalogState = (updates: Partial<CatalogWorkflowState>, targetWorkflow?: 'itc' | 'application' | 'provider') => {
    const workflow = targetWorkflow ?? (activeTab === 'itc' ? 'itc' : activeTab === 'application' ? 'application' : activeTab === 'provider' ? 'provider' : null);
    if (!workflow) return;
    
    if (workflow === 'itc') {
      setItcState(prev => prev ? { ...prev, ...updates } : null);
    } else if (workflow === 'application') {
      setApplicationState(prev => prev ? { ...prev, ...updates } : null);
    } else {
      setProviderState(prev => prev ? { ...prev, ...updates } : null);
    }
  };

  // Handle workflow selection from WorkflowSelector
  const handleWorkflowSelect = (workflow: WorkflowType) => {
    if (workflow === 'chat') {
      // Switch directly to chat tab and show it
      setShowChatTab(true);
      setActiveTab('chat');
      toast.success('Research Chat ready');
    } else {
      // Check if this workflow type already has an active session
      const existingState = workflow === 'itc' ? itcState : workflow === 'application' ? applicationState : providerState;
      if (existingState) {
        // Just switch to the existing tab
        setActiveTab(workflow);
        toast.info(`Switched to existing ${getWorkflowLabel(workflow)} workflow`);
      } else {
        // Set up new catalog workflow
        setPendingCatalogWorkflow(workflow);
        setActiveTab(workflow);
        toast.success(`${getWorkflowLabel(workflow)} workflow selected`);
      }
    }
  };

  // Handle entry form submission - now we have name and optional URL
  const handleEntrySubmit = (name: string, url?: string) => {
    const workflow = pendingCatalogWorkflow!;
    
     // Get all fields for the workflow and create field entries
     const workflowFields = getFieldsForWorkflow(workflow);
     const allFields: FieldRecommendation[] = workflowFields.map(field => {
       if (field.fieldId === 'name') {
         // Name field is pre-filled by user
         return {
           fieldId: 'name',
           fieldName: field.fieldName,
           currentValue: name,
           recommendation: name,
           confidence: 1,
           reasoning: 'Name provided by user at start of cataloging process',
           isLoading: false
         };
       }
       // Set other fields to loading state - we'll auto-generate
       return {
         fieldId: field.fieldId,
         fieldName: field.fieldName,
         currentValue: undefined,
         recommendation: undefined,
         confidence: undefined,
         reasoning: undefined,
         isLoading: true // Start in loading state for auto-generation
       };
     });
    
    // Create full catalog state for the specific workflow
    const newState: CatalogWorkflowState = {
      workflowType: workflow,
      showEntryForm: false,
      recommendations: allFields,
      isAnalyzing: true, // Start analyzing immediately
      pageContext: getPageContext(workflow),
      activeFieldId: null,
      approvedComponentName: name,
      productUrl: url,
      nameFieldStatus: 'valid',
      urlCache: {},
    };
    
    setActiveCatalogState(workflow, newState);
    
    // Clear pending workflow since it's now saved
    setPendingCatalogWorkflow(null);
    
    const entityLabel = workflow === 'application' ? 'Application' : workflow === 'provider' ? 'Provider' : 'Component';
    toast.success(`${entityLabel} identified: ${name}. Generating recommendations...`);
    
    // Auto-trigger recommendation generation
    setTimeout(() => {
      triggerAutoGenerate(workflow, allFields, name, url);
    }, 100);
  };
  
  // Auto-generate recommendations after entry form submission
  const triggerAutoGenerate = async (
    workflow: 'itc' | 'application' | 'provider',
    fields: FieldRecommendation[],
    componentName: string,
    productUrlParam?: string
  ) => {
    const setter = workflow === 'itc' ? setItcState : workflow === 'application' ? setApplicationState : setProviderState;
    const context = getPageContext(workflow);
    
    try {
      const fieldsToAnalyze = fields
        .filter(f => f.fieldId !== 'name') // Skip name field, already filled
        .map(r => ({
          fieldId: r.fieldId,
          fieldName: r.fieldName,
          currentValue: r.currentValue,
        }));

      const result = await generateRecommendations(
        fieldsToAnalyze, 
        context, 
        componentName, 
        {}, // Empty URL cache for first run
        workflow, 
        productUrlParam
      );

      const newUrlCache = result.cachedUrls ?? {};

      setter(prev => {
        if (!prev) return null;
        
        const updatedRecommendations: FieldRecommendation[] = prev.recommendations.map(field => {
          if (field.fieldId === 'name') return field; // Keep name as-is
          const rec = result.recommendations.find(r => r.fieldId === field.fieldId);
          return {
            fieldId: field.fieldId,
            fieldName: field.fieldName,
            currentValue: field.currentValue,
            recommendation: rec?.recommendation,
            confidence: rec?.confidence,
            reasoning: rec?.reasoning,
            isOfficialSource: rec?.isOfficialSource,
            isLoading: false,
          };
        });

        return {
          ...prev,
          isAnalyzing: false,
          urlCache: newUrlCache,
          recommendations: updatedRecommendations,
        };
      });
      
      toast.success("AI analysis complete!");
    } catch (error) {
      console.error('Error auto-generating recommendations:', error);
      toast.error(error instanceof Error ? error.message : "Failed to generate recommendations");
      setter(prev => prev ? {
        ...prev,
        isAnalyzing: false,
        recommendations: prev.recommendations.map(r => ({ ...r, isLoading: false }))
      } : null);
    }
  };

  // Check if name matches the expected format based on workflow
  const isValidComponentNameFormat = (name: string): boolean => {
    if (!workflowType) return false;
    return isValidNameFormat(name, workflowType);
  };

  // Generate recommendation for a single field
  const generateSingleFieldRecommendation = useCallback(async (field: FieldData, targetWorkflow?: 'itc' | 'application' | 'provider') => {
    const state = targetWorkflow 
      ? (targetWorkflow === 'itc' ? itcState : targetWorkflow === 'application' ? applicationState : providerState)
      : catalogState;
    if (!state) return;
    
    // Set this field to loading
    updateCatalogState({
      recommendations: state.recommendations.map(r => 
        r.fieldId === field.fieldId ? { ...r, isLoading: true } : r
      )
    }, state.workflowType);

    try {
      // Pass the approved component name, cached URLs, and product URL to anchor the search
      const result = await generateRecommendations(
        [field], 
        state.pageContext, 
        state.approvedComponentName || undefined, 
        state.urlCache, 
        state.workflowType, 
        state.productUrl
      );
      const rec = result.recommendations.find(r => r.fieldId === field.fieldId);
      
      // Update URL cache if new URLs were returned
      const newUrlCache = result.cachedUrls 
        ? { ...state.urlCache, ...result.cachedUrls }
        : state.urlCache;
      
      const setter = state.workflowType === 'itc' ? setItcState : state.workflowType === 'application' ? setApplicationState : setProviderState;
      setter(prev => prev ? {
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
      const setter = state.workflowType === 'itc' ? setItcState : state.workflowType === 'application' ? setApplicationState : setProviderState;
      setter(prev => prev ? {
        ...prev,
        recommendations: prev.recommendations.map(r => 
          r.fieldId === field.fieldId ? { ...r, isLoading: false } : r
        )
      } : null);
      toast.error(`Failed to get recommendation for ${field.fieldName}`);
    }
  }, [catalogState, itcState, applicationState]);

  // Handle active field change from content script - fetch recommendation for that field only
  const handleActiveFieldChange = useCallback((field: FieldData) => {
    if (!catalogState) return;
    
    const isNameField = field.fieldName?.toLowerCase() === 'name';
    const workflow = catalogState.workflowType;
    const setter = workflow === 'itc' ? setItcState : workflow === 'application' ? setApplicationState : setProviderState;
    
    setter(prev => {
      if (!prev) return null;
      
      const existingIndex = prev.recommendations.findIndex(r => r.fieldId === field.fieldId);
      
      if (existingIndex >= 0) {
        const existing = prev.recommendations[existingIndex];
        const updated = prev.recommendations.filter(r => r.fieldId !== field.fieldId);
        const updatedField = { ...existing, currentValue: field.currentValue };
        
        if (!existing.recommendation && !existing.isLoading) {
          if (prev.approvedComponentName || isNameField) {
            setTimeout(() => generateSingleFieldRecommendation(field, workflow), 0);
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
          setTimeout(() => generateSingleFieldRecommendation(field, workflow), 0);
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
    
    const workflow = catalogState.workflowType;
    
    updateCatalogState({ isAnalyzing: true }, workflow);
    
    // Set all fields to loading
    updateCatalogState({
      recommendations: catalogState.recommendations.map(r => ({ ...r, isLoading: true, recommendation: undefined }))
    }, workflow);

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

      const setter = workflow === 'itc' ? setItcState : workflow === 'application' ? setApplicationState : setProviderState;
      setter(prev => prev ? {
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
      }, workflow);
    }
  };

  const handleApply = async (fieldId: string, value: string) => {
    if (!catalogState) return;
    
    const workflow = catalogState.workflowType;
    const setter = workflow === 'itc' ? setItcState : workflow === 'application' ? setApplicationState : setProviderState;
    
    const field = catalogState.recommendations.find(r => r.fieldId === fieldId);
    if (field?.fieldName?.toLowerCase() === 'name' && value) {
      if (isValidComponentNameFormat(value)) {
        updateCatalogState({ 
          approvedComponentName: value,
          nameFieldStatus: 'valid'
        }, workflow);
        toast.success(`${catalogState.workflowType === 'application' ? 'Application' : catalogState.workflowType === 'provider' ? 'Provider' : 'Component'} name approved: ${value}`);
      } else {
        updateCatalogState({ nameFieldStatus: 'invalid' }, workflow);
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
                setter(prev => prev ? {
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
      setter(prev => prev ? {
        ...prev,
        recommendations: prev.recommendations.map(r =>
          r.fieldId === fieldId ? { ...r, currentValue: value } : r
        )
      } : null);
    }
  };

  const handleEditValue = (fieldId: string, value: string) => {
    if (!catalogState) return;
    const workflow = catalogState.workflowType;
     const setter = workflow === 'itc' ? setItcState : workflow === 'application' ? setApplicationState : setProviderState;
    
    setter(prev => prev ? {
      ...prev,
      recommendations: prev.recommendations.map(r =>
        r.fieldId === fieldId ? { ...r, recommendation: value } : r
      )
    } : null);
  };

  const handleRemoveField = (fieldId: string) => {
    if (!catalogState) return;
    const workflow = catalogState.workflowType;
     const setter = workflow === 'itc' ? setItcState : workflow === 'application' ? setApplicationState : setProviderState;
    
    setter(prev => prev ? {
      ...prev,
      recommendations: prev.recommendations.filter(r => r.fieldId !== fieldId)
    } : null);
    toast.info("Field removed");
  };

  // Close a specific workflow tab
  const handleCloseWorkflow = (workflow: 'itc' | 'application' | 'provider') => {
    if (workflow === 'itc') {
      setItcState(null);
    } else if (workflow === 'application') {
      setApplicationState(null);
    } else {
      setProviderState(null);
    }
    
    // If we're closing the active tab, switch to another tab
    if (activeTab === workflow) {
      if (workflow === 'itc' && applicationState) {
        setActiveTab('application');
      } else if (workflow === 'itc' && providerState) {
        setActiveTab('provider');
      } else if (workflow === 'application' && itcState) {
        setActiveTab('itc');
      } else if (workflow === 'application' && providerState) {
        setActiveTab('provider');
      } else if (workflow === 'provider' && itcState) {
        setActiveTab('itc');
      } else if (workflow === 'provider' && applicationState) {
        setActiveTab('application');
      } else {
        setActiveTab('chat');
      }
    }
    
    toast.success(`${workflow === 'itc' ? 'IT Component' : workflow === 'application' ? 'Application' : 'Provider'} workflow closed`);
  };

  const handleBackFromEntry = () => {
    setPendingCatalogWorkflow(null);
    // Go back to workflow selector if no active sessions
    if (!itcState && !applicationState && !providerState) {
      setActiveTab('workflow');
    } else if (itcState) {
      setActiveTab('itc');
    } else if (applicationState) {
      setActiveTab('application');
    } else if (providerState) {
      setActiveTab('provider');
    } else {
      setActiveTab('chat');
    }
  };

  // Determine if we have any active catalog sessions
  const hasItcSession = itcState !== null;
  const hasApplicationSession = applicationState !== null;
  const hasProviderSession = providerState !== null;
  const hasAnyCatalogSession = hasItcSession || hasApplicationSession || hasProviderSession;
  
  // Show tabs when we have at least one active workflow, pending workflow, or chat is open
  const showBottomTabs = hasAnyCatalogSession || pendingCatalogWorkflow !== null || showChatTab;
  
  // Handle closing the chat tab
  const handleCloseChat = () => {
    setShowChatTab(false);
    // Switch to another available tab
    if (hasItcSession) {
      setActiveTab('itc');
    } else if (hasApplicationSession) {
      setActiveTab('application');
    } else if (hasProviderSession) {
      setActiveTab('provider');
    } else {
      setActiveTab('workflow');
    }
    toast.success('Research Chat closed');
  };

  // Render catalog workflow content for a specific tab type
  const renderCatalogContent = (tabType: 'itc' | 'application' | 'provider') => {
    const state = tabType === 'itc' ? itcState : tabType === 'application' ? applicationState : providerState;
    
    // If we're setting up a new catalog workflow
    if (pendingCatalogWorkflow === tabType && !state) {
      return (
        <EntryForm 
          workflowType={pendingCatalogWorkflow}
          onSubmit={handleEntrySubmit}
          onBack={handleBackFromEntry}
        />
      );
    }
    
    // Show active catalog workflow
    if (state) {
      if (showSettings && activeTab === tabType) {
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
            onStartOver={() => handleCloseWorkflow(tabType)}
            isConnected={apiKeyConfigured}
          />
          <RecommendationList
            recommendations={state.recommendations}
            isAnalyzing={state.isAnalyzing}
            onRefresh={handleGenerateRecommendations}
            onRefreshField={handleRefreshField}
            onApply={handleApply}
            onEditValue={handleEditValue}
            onRemoveField={handleRemoveField}
            activeFieldId={state.activeFieldId}
          />
        </>
      );
    }
    
    return null;
  };

  // Check if we can open a new workflow (both aren't already open)
  const canOpenNewWorkflow = !hasItcSession || !hasApplicationSession || !hasProviderSession;

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

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="extension-popup flex flex-col items-center justify-center bg-background rounded-lg border border-border shadow-lg p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Show auth screen if not logged in
  if (!user) {
    return (
      <div className="extension-popup flex flex-col bg-background overflow-hidden rounded-lg border border-border shadow-lg">
        <AuthScreen />
      </div>
    );
  }

  return (
    <div className="extension-popup flex flex-col bg-background overflow-hidden rounded-lg border border-border shadow-lg">
      {/* Chrome-style tab bar at top when we have active sessions */}
      {showBottomTabs && (
        <div className="flex items-end gap-0.5 px-2 pt-2 bg-muted/30 border-b border-border">
          {/* ITC Tab */}
          {(hasItcSession || pendingCatalogWorkflow === 'itc') && (
            <ChromeTab
              active={activeTab === 'itc'}
              icon={<Monitor className="h-4 w-4" />}
              label="IT Component"
              onClick={() => setActiveTab('itc')}
              onClose={() => {
                if (pendingCatalogWorkflow === 'itc') {
                  setPendingCatalogWorkflow(null);
                  setActiveTab(hasApplicationSession ? 'application' : 'chat');
                } else {
                  handleCloseWorkflow('itc');
                }
              }}
            />
          )}
          
          {/* Application Tab */}
          {(hasApplicationSession || pendingCatalogWorkflow === 'application') && (
            <ChromeTab
              active={activeTab === 'application'}
              icon={<Cloud className="h-4 w-4" />}
              label="Application"
              onClick={() => setActiveTab('application')}
              onClose={() => {
                if (pendingCatalogWorkflow === 'application') {
                  setPendingCatalogWorkflow(null);
                  setActiveTab(hasItcSession ? 'itc' : hasProviderSession ? 'provider' : 'chat');
                } else {
                  handleCloseWorkflow('application');
                }
              }}
            />
          )}
          
          {/* Provider Tab */}
          {(hasProviderSession || pendingCatalogWorkflow === 'provider') && (
            <ChromeTab
              active={activeTab === 'provider'}
              icon={<Building2 className="h-4 w-4" />}
              label="Provider"
              onClick={() => setActiveTab('provider')}
              onClose={() => {
                if (pendingCatalogWorkflow === 'provider') {
                  setPendingCatalogWorkflow(null);
                  setActiveTab(hasItcSession ? 'itc' : hasApplicationSession ? 'application' : 'chat');
                } else {
                  handleCloseWorkflow('provider');
                }
              }}
            />
          )}
          
          {/* Research Chat Tab */}
          {showChatTab && (
            <ChromeTab
              active={activeTab === 'chat'}
              icon={<Sparkles className="h-4 w-4" />}
              label="Research Chat"
              onClick={() => setActiveTab('chat')}
              onClose={handleCloseChat}
            />
          )}
          
          {/* New tab button - only when not all workflows are open */}
          {(canOpenNewWorkflow || !showChatTab) && activeTab !== 'workflow' && (
            <NewTabButton onClick={() => setActiveTab('workflow')} />
          )}
        </div>
      )}
      
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        {/* Workflow selector - shown when activeTab is 'workflow' (for adding new tabs) */}
        <div className={cn(
          "absolute inset-0 flex flex-col bg-background overflow-hidden",
          activeTab === 'workflow' ? "z-10 visible" : "z-0 invisible pointer-events-none"
        )}>
          <WorkflowSelector onSelect={handleWorkflowSelect} />
        </div>
        
        {/* ITC Tab - always rendered when session exists, visibility controlled by CSS */}
        {(hasItcSession || pendingCatalogWorkflow === 'itc') && (
          <div className={cn(
            "absolute inset-0 flex flex-col bg-background overflow-hidden",
            activeTab === 'itc' ? "z-10 visible" : "z-0 invisible pointer-events-none"
          )}>
            {renderCatalogContent('itc')}
          </div>
        )}
        
        {/* Application Tab - always rendered when session exists, visibility controlled by CSS */}
        {(hasApplicationSession || pendingCatalogWorkflow === 'application') && (
          <div className={cn(
            "absolute inset-0 flex flex-col bg-background overflow-hidden",
            activeTab === 'application' ? "z-10 visible" : "z-0 invisible pointer-events-none"
          )}>
            {renderCatalogContent('application')}
          </div>
        )}
        
        {/* Provider Tab - always rendered when session exists, visibility controlled by CSS */}
        {(hasProviderSession || pendingCatalogWorkflow === 'provider') && (
          <div className={cn(
            "absolute inset-0 flex flex-col bg-background overflow-hidden",
            activeTab === 'provider' ? "z-10 visible" : "z-0 invisible pointer-events-none"
          )}>
            {renderCatalogContent('provider')}
          </div>
        )}
        
        {/* Research Chat - always rendered when showChatTab is true, visibility controlled by CSS */}
        {showChatTab && (
          <div className={cn(
            "absolute inset-0 flex flex-col bg-background overflow-hidden",
            activeTab === 'chat' ? "z-10 visible" : "z-0 invisible pointer-events-none"
          )}>
            <PerplexityChat 
              embedded={showBottomTabs}
              onBack={!showBottomTabs ? () => setActiveTab(hasAnyCatalogSession ? (hasItcSession ? 'itc' : hasApplicationSession ? 'application' : 'provider') : 'workflow') : undefined}
              messages={chatMessages}
              onMessagesChange={setChatMessages}
              input={chatInput}
              onInputChange={setChatInput}
              domainFilter={chatDomainFilter}
              onDomainFilterChange={setChatDomainFilter}
              onClearChat={() => {
                setChatMessages([]);
                setChatInput("");
                setChatDomainFilter("");
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
