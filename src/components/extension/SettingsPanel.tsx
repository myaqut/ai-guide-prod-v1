import { useState } from "react";
import { ArrowLeft, Key, Save, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface SettingsPanelProps {
  onBack: () => void;
  apiKey: string;
  onSaveApiKey: (key: string) => void;
}

export const SettingsPanel = ({ onBack, apiKey, onSaveApiKey }: SettingsPanelProps) => {
  const [key, setKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    if (!key.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    if (!key.startsWith("sk-")) {
      toast.error("Invalid API key format. Should start with 'sk-'");
      return;
    }
    onSaveApiKey(key.trim());
    toast.success("API key saved successfully");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-gradient-card">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* API Key Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            <Label className="text-sm font-medium">OpenAI API Key</Label>
          </div>
          
          <div className="space-y-2">
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-..."
                className="pr-10 bg-muted/50 border-border focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            
            <p className="text-[10px] text-muted-foreground">
              Your API key is stored locally and never sent to our servers.
            </p>
          </div>

          <Button
            variant="glow"
            size="sm"
            onClick={handleSave}
            className="w-full"
          >
            <Save className="w-3 h-3" />
            Save API Key
          </Button>
        </div>

        {/* Info Section */}
        <div className="rounded-lg bg-muted/30 p-3 space-y-2">
          <h3 className="text-xs font-medium text-foreground">How to get an API key</h3>
          <ol className="text-[10px] text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Go to OpenAI Platform</li>
            <li>Sign in or create an account</li>
            <li>Navigate to API Keys section</li>
            <li>Create a new secret key</li>
            <li>Copy and paste it here</li>
          </ol>
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-2"
          >
            <ExternalLink className="w-3 h-3" />
            Open OpenAI Platform
          </a>
        </div>

        {/* Naming Convention */}
        <div className="rounded-lg border border-border p-3 space-y-2">
          <h3 className="text-xs font-medium text-foreground">Naming Convention</h3>
          <p className="text-[10px] text-muted-foreground">
            The AI will suggest names following this pattern:
          </p>
          <code className="block text-[10px] bg-muted rounded px-2 py-1 text-primary font-mono">
            [Provider] + [Product] + [Version]
          </code>
          <p className="text-[10px] text-muted-foreground">
            Example: <span className="text-foreground">MongoDB Community Server 8.2</span>
          </p>
        </div>
      </div>
    </div>
  );
};
