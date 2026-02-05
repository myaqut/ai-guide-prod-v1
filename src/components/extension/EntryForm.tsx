import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Globe, Package, AlertCircle, CheckCircle2, Building2 } from "lucide-react";
import { WorkflowType } from "./WorkflowSelector";
import { isValidNameFormat, getNameFormatGuidance } from "@/lib/workflow-config";

interface EntryFormProps {
  workflowType: WorkflowType;
  onSubmit: (name: string, url?: string) => void;
  onBack: () => void;
}

export const EntryForm = ({ workflowType, onSubmit, onBack }: EntryFormProps) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const isITC = workflowType === 'itc';
  const isProvider = workflowType === 'provider';
  const entityLabel = isITC ? 'IT Component' : isProvider ? 'Provider' : 'Application';
  
  // Validate name format
  const validateName = (value: string): boolean => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    
    if (!isValidNameFormat(value, workflowType)) {
      setNameError(getNameFormatGuidance(workflowType));
      return false;
    }
    
    setNameError(null);
    return true;
  };

  // Validate URL format (optional but must be valid if provided)
  const validateUrl = (value: string): boolean => {
    if (!value.trim()) {
      setUrlError(null);
      return true; // URL is optional
    }
    
    try {
      new URL(value);
      setUrlError(null);
      return true;
    } catch {
      setUrlError("Please enter a valid URL (e.g., https://example.com)");
      return false;
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (value.trim()) {
      validateName(value);
    } else {
      setNameError(null);
    }
  };

  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (value.trim()) {
      validateUrl(value);
    } else {
      setUrlError(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const isNameValid = validateName(name);
    const isUrlValid = validateUrl(url);
    
    if (isNameValid && isUrlValid) {
      onSubmit(name.trim(), url.trim() || undefined);
    }
  };

  const isValid = name.trim() && isValidNameFormat(name, workflowType) && (!url.trim() || !urlError);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          New {entityLabel}
        </h2>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Change Workflow
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {isProvider ? (
              <Building2 className="h-4 w-4 text-primary" />
            ) : (
              <Package className="h-4 w-4 text-primary" />
            )}
            {entityLabel} Details
          </CardTitle>
          <CardDescription>
            {isProvider 
              ? "Enter the company name to research."
              : `Enter the ${entityLabel.toLowerCase()} name and optionally a reference URL.`
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name Field - Mandatory */}
            <div className="space-y-2">
              <Label htmlFor="name" className="flex items-center gap-1">
                Name <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="name"
                  type="text"
                  placeholder={isITC ? "e.g., Microsoft SQL Server 2022" : isProvider ? "e.g., Microsoft or Salesforce" : "e.g., Salesforce Sales Cloud"}
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className={nameError ? "border-destructive pr-10" : isValid ? "border-green-500 pr-10" : ""}
                />
                {nameError && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
                )}
                {isValid && !nameError && name.trim() && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                )}
              </div>
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {isProvider
                  ? "Enter the company name. Example: Microsoft, Salesforce, Oracle"
                  : isITC 
                  ? "Format: [Company] + [Product Name] + [Version]. Example: Microsoft SQL Server 2022"
                  : "Format: [Company] + [Product Name]. Example: Salesforce Sales Cloud"
                }
              </p>
            </div>

            {/* URL Field - Optional (not shown for Provider workflow) */}
            {!isProvider && (
              <div className="space-y-2">
              <Label htmlFor="url" className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5" />
                Product URL <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="url"
                type="text"
                placeholder="https://www.example.com/product"
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                className={urlError ? "border-destructive" : ""}
              />
              {urlError && (
                <p className="text-xs text-destructive">{urlError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Providing the official product URL helps improve search accuracy.
              </p>
            </div>
            )}

            {/* Submit Button */}
            <Button 
              type="submit" 
              className="w-full" 
              disabled={!isValid}
            >
              {isProvider ? 'Start Research' : 'Start Cataloging'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Tips */}
      <Card className="bg-muted/50">
        <CardContent className="pt-4">
          <h4 className="text-sm font-medium mb-2">💡 Tips</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            {isProvider ? (
              <>
                <li>• The company name will be used to search for official information</li>
                <li>• Results are sourced from official company website and LinkedIn</li>
              </>
            ) : (
              <>
                <li>• The name will be used to search for all field recommendations</li>
                <li>• Adding a URL helps the AI find accurate lifecycle dates and documentation</li>
              </>
            )}
            {isITC && <li>• Include the version number for accurate lifecycle information</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};
