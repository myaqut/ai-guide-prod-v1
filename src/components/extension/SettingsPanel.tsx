import { ArrowLeft, Key, CheckCircle, ExternalLink, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SettingsPanelProps {
  onBack: () => void;
  apiKey: string;
  onSaveApiKey: (key: string) => void;
}

export const SettingsPanel = ({ onBack }: SettingsPanelProps) => {
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
        {/* API Key Status */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">OpenAI API Key</span>
          </div>
          
          <div className="rounded-lg bg-success/10 border border-success/20 p-3 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-success shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-success">Configured via Cloud</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your OpenAI API key is securely stored in Lovable Cloud. No additional setup needed.
              </p>
            </div>
          </div>
        </div>

        {/* Cloud Info */}
        <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-medium text-foreground">Powered by Lovable Cloud</h3>
          </div>
          <p className="text-[10px] text-muted-foreground">
            This extension uses Lovable Cloud for secure API key storage and AI processing. 
            Your data never leaves our secure infrastructure.
          </p>
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
          <div className="text-[10px] text-muted-foreground space-y-0.5 mt-2">
            <p><span className="text-foreground">Example:</span> MongoDB Community Server 8.2</p>
            <p><span className="text-foreground">Example:</span> Oracle Database Enterprise 19c</p>
            <p><span className="text-foreground">Example:</span> Apache Kafka 3.5</p>
          </div>
        </div>

        {/* How It Works */}
        <div className="rounded-lg bg-muted/30 p-3 space-y-2">
          <h3 className="text-xs font-medium text-foreground">How It Works</h3>
          <ol className="text-[10px] text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Extension detects form fields on the page</li>
            <li>AI analyzes the context and current values</li>
            <li>Suggestions are generated following best practices</li>
            <li>Click Apply to fill in the recommended value</li>
          </ol>
        </div>

        {/* Links */}
        <div className="flex flex-col gap-2">
          <a
            href="https://docs.lovable.dev/features/cloud"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Learn about Lovable Cloud
          </a>
        </div>
      </div>
    </div>
  );
};
