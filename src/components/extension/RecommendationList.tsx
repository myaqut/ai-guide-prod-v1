import { FieldCard } from "./FieldCard";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FieldRecommendation {
  fieldName: string;
  fieldId: string;
  currentValue?: string;
  recommendation?: string;
  confidence?: number;
  reasoning?: string;
  isLoading?: boolean;
}

interface RecommendationListProps {
  recommendations: FieldRecommendation[];
  isAnalyzing: boolean;
  onRefresh: () => void;
  onRefreshField: (fieldId: string) => void;
  onApply: (fieldId: string, value: string) => void;
  onEditValue: (fieldId: string, value: string) => void;
  onRemoveField: (fieldId: string) => void;
  activeFieldId?: string | null;
}

export const RecommendationList = ({
  recommendations,
  isAnalyzing,
  onRefresh,
  onRefreshField,
  onApply,
  onEditValue,
  onRemoveField,
  activeFieldId,
}: RecommendationListProps) => {
  const hasRecommendations = recommendations.some(r => r.recommendation);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Action Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-slate-700">
            {isAnalyzing ? "Analyzing page..." : `${recommendations.length} fields detected`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onRefresh}
          disabled={isAnalyzing}
          className="text-slate-600 hover:text-slate-800"
        >
          <RefreshCw className={`w-3 h-3 ${isAnalyzing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Recommendations */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
        {recommendations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6 text-slate-500" />
            </div>
            <h3 className="text-sm font-medium text-slate-800 mb-1">No fields detected</h3>
            <p className="text-xs text-slate-500 max-w-[200px]">
              Navigate to a LeanIX catalog page to see AI recommendations for form fields.
            </p>
          </div>
        ) : !hasRecommendations && !isAnalyzing ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-sm font-medium text-slate-800 mb-1">{recommendations.length} fields ready</h3>
            <p className="text-xs text-slate-500 max-w-[200px] mb-4">
              Click below to generate AI-powered recommendations for these fields.
            </p>
            <Button
              variant="glow"
              onClick={() => {
                console.log('Button onClick fired!');
                onRefresh();
              }}
              className="gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Generate Recommendations
            </Button>
          </div>
        ) : (
          recommendations.map((rec) => (
            <FieldCard
              key={rec.fieldId}
              fieldId={rec.fieldId}
              fieldName={rec.fieldName}
              currentValue={rec.currentValue}
              recommendation={rec.recommendation}
              confidence={rec.confidence}
              reasoning={rec.reasoning}
              isLoading={rec.isLoading}
              isActive={rec.fieldId === activeFieldId}
              onApply={(value) => onApply(rec.fieldId, value)}
              onRefresh={() => onRefreshField(rec.fieldId)}
              onEditValue={(value) => onEditValue(rec.fieldId, value)}
              onRemove={() => onRemoveField(rec.fieldId)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {hasRecommendations && (
        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50">
          <Button
            variant="glow"
            className="w-full"
            onClick={() => {
              recommendations.forEach(rec => {
                if (rec.recommendation) {
                  onApply(rec.fieldId, rec.recommendation);
                }
              });
            }}
          >
            <Sparkles className="w-4 h-4" />
            Apply All Recommendations
          </Button>
        </div>
      )}
    </div>
  );
};
