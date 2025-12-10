import { Settings, Zap, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import extensionLogo from "@/assets/extension-logo.png";

interface HeaderProps {
  onSettingsClick: () => void;
  onStartOver: () => void;
  isConnected: boolean;
}

export const Header = ({ onSettingsClick, onStartOver, isConnected }: HeaderProps) => {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-2">
        <div className="relative">
          <img src={extensionLogo} alt="Researcher AI Assistant" className="w-8 h-8 rounded-lg" />
          {isConnected && (
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-card" />
          )}
        </div>
        <div>
          <h1 className="text-sm font-semibold text-slate-800">Catalog AI</h1>
          <p className="text-[10px] text-slate-500">Smart Field Assistant</p>
        </div>
      </div>
      
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 mr-2">
          <Zap className="w-3 h-3 text-primary" />
          <span className="text-[10px] text-primary font-medium">
            {isConnected ? "Ready" : "Disconnected"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onStartOver}
          title="Start over"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={onSettingsClick}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
};
