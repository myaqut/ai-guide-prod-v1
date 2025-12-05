import { Sparkles, Settings, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  onSettingsClick: () => void;
  isConnected: boolean;
}

export const Header = ({ onSettingsClick, isConnected }: HeaderProps) => {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-card">
      <div className="flex items-center gap-2">
        <div className="relative">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          {isConnected && (
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-card" />
          )}
        </div>
        <div>
          <h1 className="text-sm font-semibold text-foreground">Catalog AI</h1>
          <p className="text-[10px] text-muted-foreground">Smart Field Assistant</p>
        </div>
      </div>
      
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 mr-2">
          <Zap className="w-3 h-3 text-primary" />
          <span className="text-[10px] text-muted-foreground font-medium">
            {isConnected ? "Ready" : "Disconnected"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onSettingsClick}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
};
