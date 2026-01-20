import { Monitor, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type WorkflowType = 'itc' | 'application';

interface WorkflowSelectorProps {
  onSelect: (workflow: WorkflowType) => void;
}

export const WorkflowSelector = ({ onSelect }: WorkflowSelectorProps) => {
  return (
    <div className="flex flex-col gap-4 p-4 bg-background">
      <div className="text-center mb-2">
        <h2 className="text-lg font-semibold text-foreground">Select Workflow</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Choose the type of fact sheet you're working with
        </p>
      </div>
      
      <div className="grid gap-3">
        <Card 
          className="cursor-pointer transition-all hover:border-primary hover:shadow-md group"
          onClick={() => onSelect('itc')}
        >
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Monitor className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">IT Component</CardTitle>
                <CardDescription className="text-xs">
                  Software, databases, frameworks
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-xs text-muted-foreground">
              Lifecycle dates, versions, vendor info, technical documentation
            </p>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer transition-all hover:border-accent hover:shadow-md group"
          onClick={() => onSelect('application')}
        >
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Application</CardTitle>
                <CardDescription className="text-xs">
                  SaaS, business applications
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-xs text-muted-foreground">
              Vendor info, pricing, integrations, compliance, user access
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
