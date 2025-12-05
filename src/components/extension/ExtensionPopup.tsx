import { useState, useEffect } from "react";
import { Header } from "./Header";
import { SettingsPanel } from "./SettingsPanel";
import { RecommendationList, FieldRecommendation } from "./RecommendationList";
import { toast } from "sonner";

// Simulated page data (in real extension, this comes from content script)
const MOCK_FIELDS: FieldRecommendation[] = [
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
  const [apiKey, setApiKey] = useState("");
  const [recommendations, setRecommendations] = useState<FieldRecommendation[]>(MOCK_FIELDS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Load API key from localStorage
  useEffect(() => {
    const savedKey = localStorage.getItem("catalog_ai_api_key");
    if (savedKey) {
      setApiKey(savedKey);
    }
  }, []);

  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("catalog_ai_api_key", key);
  };

  const generateRecommendations = async () => {
    if (!apiKey) {
      toast.error("Please configure your OpenAI API key first");
      setShowSettings(true);
      return;
    }

    setIsAnalyzing(true);
    
    // Set all fields to loading
    setRecommendations(prev => prev.map(r => ({ ...r, isLoading: true })));

    try {
      // Simulate API call with realistic delay
      // In production, this would call the OpenAI API
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Generate mock recommendations based on naming convention
      const mockRecommendations: FieldRecommendation[] = [
        {
          fieldId: "name",
          fieldName: "Name",
          currentValue: "Mongo db 8.2",
          recommendation: "MongoDB Community Server 8.2",
          confidence: 0.92,
          reasoning: "Following the naming convention: Provider (MongoDB) + Product (Community Server) + Version (8.2). MongoDB is the official provider name, and 'Community Server' is the official product name for this database edition.",
        },
        {
          fieldId: "external_id",
          fieldName: "External ID",
          currentValue: "lx_ITC_660317",
          recommendation: "lx_ITC_660317",
          confidence: 0.95,
          reasoning: "The current External ID follows the established pattern and appears to be correctly formatted. No changes recommended.",
        },
        {
          fieldId: "description",
          fieldName: "Description",
          currentValue: "",
          recommendation: "MongoDB Community Server 8.2 is a general-purpose, document-oriented NoSQL database platform. This version includes enhanced query performance, improved aggregation pipeline features, and better horizontal scaling capabilities.",
          confidence: 0.85,
          reasoning: "Generated based on the product name and version. The description covers key features and positioning of MongoDB as a database solution.",
        },
        {
          fieldId: "category",
          fieldName: "Category",
          currentValue: "",
          recommendation: "Database / NoSQL",
          confidence: 0.88,
          reasoning: "MongoDB is primarily categorized as a NoSQL document database. This category reflects its core functionality within IT architecture.",
        },
        {
          fieldId: "lifecycle_status",
          fieldName: "Lifecycle Status",
          currentValue: "",
          recommendation: "Active",
          confidence: 0.75,
          reasoning: "MongoDB 8.2 is a current release with active support from MongoDB Inc. The lifecycle status reflects its production readiness.",
        },
      ];

      setRecommendations(mockRecommendations);
      toast.success("Analysis complete!");
    } catch (error) {
      toast.error("Failed to generate recommendations");
      setRecommendations(prev => prev.map(r => ({ ...r, isLoading: false })));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApply = (fieldId: string, value: string) => {
    // In a real extension, this would communicate with the content script
    // to update the actual form field on the page
    toast.success(`Applied "${value}" to ${fieldId}`);
    
    // Update local state to show the value was applied
    setRecommendations(prev =>
      prev.map(r =>
        r.fieldId === fieldId
          ? { ...r, currentValue: value }
          : r
      )
    );
  };

  // Auto-analyze on mount if API key exists
  useEffect(() => {
    if (apiKey && recommendations.every(r => !r.recommendation)) {
      generateRecommendations();
    }
  }, [apiKey]);

  const isConnected = !!apiKey;

  return (
    <div className="extension-popup flex flex-col bg-background overflow-hidden rounded-lg border border-border shadow-lg">
      {showSettings ? (
        <SettingsPanel
          onBack={() => setShowSettings(false)}
          apiKey={apiKey}
          onSaveApiKey={handleSaveApiKey}
        />
      ) : (
        <>
          <Header
            onSettingsClick={() => setShowSettings(true)}
            isConnected={isConnected}
          />
          <RecommendationList
            recommendations={recommendations}
            isAnalyzing={isAnalyzing}
            onRefresh={generateRecommendations}
            onApply={handleApply}
          />
        </>
      )}
    </div>
  );
};
