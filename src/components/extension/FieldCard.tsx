import { useState } from "react";
import { Check, Copy, ChevronDown, ChevronUp, Lightbulb, RefreshCw, Pencil, X, Trash2, ShieldCheck, Globe, Link2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FieldCardProps {
  fieldId: string;
  fieldName: string;
  currentValue?: string;
  recommendation?: string;
  confidence?: number;
  reasoning?: string;
  isLoading?: boolean;
  isActive?: boolean;
  isOfficialSource?: boolean;
  onApply?: (value: string) => void;
  onRefresh?: () => void;
  onEditValue?: (value: string) => void;
  onRemove?: () => void;
}

// Helper to check if a string is a valid URL
function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const FieldCard = ({
  fieldId,
  fieldName,
  currentValue,
  recommendation,
  confidence,
  reasoning,
  isLoading,
  isActive,
  isOfficialSource,
  onApply,
  onRefresh,
  onEditValue,
  onRemove,
}: FieldCardProps) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState("");

  // Safe rendering of text with clickable links (prevents XSS)
  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    const parts = text.split(urlRegex);
    
    return parts.map((part, index) => {
      if (urlRegex.test(part)) {
        // Reset regex lastIndex after test
        urlRegex.lastIndex = 0;
        return (
          <a 
            key={index}
            href={part} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
          >
            {part}
          </a>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  const handleCopy = async () => {
    const valueToCopy = isEditing ? editedValue : recommendation;
    if (!valueToCopy) return;
    await navigator.clipboard.writeText(valueToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    const valueToApply = isEditing ? editedValue.trim() : recommendation;
    if (valueToApply && onApply) {
      // Update parent's field value when applying edited value
      if (isEditing && onEditValue) {
        onEditValue(valueToApply);
      }
      onApply(valueToApply);
      setIsEditing(false);
    }
  };

  const handleStartEdit = () => {
    setEditedValue(recommendation || "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedValue("");
  };

  const getConfidenceColor = (conf: number) => {
    if (conf >= 0.8) return "text-success";
    if (conf >= 0.5) return "text-warning";
    return "text-muted-foreground";
  };

  const getConfidenceLabel = (conf: number) => {
    if (conf >= 0.8) return "High";
    if (conf >= 0.5) return "Medium";
    return "Low";
  };

  return (
    <div className={cn(
      "rounded-lg border bg-card p-3 animate-slide-up transition-all",
      isActive 
        ? "border-primary ring-2 ring-primary/20 shadow-md" 
        : "border-border"
    )}>
      {/* Field Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {fieldName}
            </h3>
            <Button
              variant="ghost"
              size="xs"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              title="Refresh recommendation"
            >
              <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
            </Button>
            {onRemove && (
              <Button
                variant="ghost"
                size="xs"
                onClick={onRemove}
                className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                title="Remove field"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
          {currentValue && (
            <p className="text-sm text-foreground/70 mt-0.5 truncate max-w-[200px]">
              Current: {currentValue}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Source badge */}
          {recommendation && isOfficialSource !== undefined && (
            <div className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1",
              isOfficialSource 
                ? "bg-success/10 text-success" 
                : "bg-muted text-muted-foreground"
            )}>
              {isOfficialSource ? (
                <>
                  <ShieldCheck className="w-3 h-3" />
                  Official
                </>
              ) : (
                <>
                  <Globe className="w-3 h-3" />
                  Web
                </>
              )}
            </div>
          )}
          {/* Confidence badge */}
          {confidence !== undefined && (
            <div className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted", getConfidenceColor(confidence))}>
              {getConfidenceLabel(confidence)} ({Math.round(confidence * 100)}%)
            </div>
          )}
        </div>
      </div>

      {/* Recommendation */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-3">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-typing-dot" />
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-typing-dot" />
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-typing-dot" />
          </div>
          <span className="text-xs text-muted-foreground">Analyzing...</span>
        </div>
      ) : (
        <>
          {(recommendation || isEditing) && (
            <div className="bg-muted/50 rounded-md p-2 mb-2">
              <div className="flex items-start gap-2">
                <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                {isEditing ? (
                  <Input
                    value={editedValue}
                    onChange={(e) => setEditedValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && editedValue.trim()) {
                        handleApply();
                      } else if (e.key === 'Escape') {
                        handleCancelEdit();
                      }
                    }}
                    className="text-sm h-7 py-1"
                    placeholder="Enter custom value..."
                    autoFocus
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-medium break-words">
                      {recommendation}
                    </p>
                    {/* URL Verified badge - shows when recommendation is a URL and from official source */}
                    {recommendation && isValidUrl(recommendation) && isOfficialSource && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <div className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-success/10 text-success">
                          <CheckCircle2 className="w-3 h-3" />
                          <Link2 className="w-3 h-3" />
                          Link Verified
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reasoning toggle */}
          {reasoning && !isEditing && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Hide" : "Show"} reasoning
            </button>
          )}

          {expanded && reasoning && !isEditing && (
            <p className="text-xs text-muted-foreground bg-muted/30 rounded p-2 mb-2 animate-fade-in">
              {renderTextWithLinks(reasoning)}
            </p>
          )}

          {/* No recommendation message */}
          {!recommendation && !isEditing && (
            <p className="text-xs text-muted-foreground py-2 mb-2">
              Click to load recommendation or enter manually
            </p>
          )}

          {/* Actions - always show */}
          <div className="flex gap-2">
            <Button
              variant="glow"
              size="xs"
              onClick={handleApply}
              className="flex-1"
              disabled={isEditing ? !editedValue.trim() : !recommendation}
            >
              <Check className="w-3 h-3" />
              Apply
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={isEditing ? handleCancelEdit : handleStartEdit}
              title={isEditing ? "Cancel edit" : "Edit manually"}
            >
              {isEditing ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={handleCopy}
              disabled={!recommendation && !isEditing}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
