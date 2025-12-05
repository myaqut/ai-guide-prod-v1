import { ExtensionPopup } from "@/components/extension/ExtensionPopup";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-dark flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Title section */}
        <div className="text-center space-y-3 max-w-md">
          <h1 className="text-3xl font-bold text-white">
            Catalog <span className="text-primary">AI</span> Assistant
          </h1>
          <p className="text-sm text-slate-400">
            Chrome extension popup preview. This is how the extension appears when activated on a LeanIX catalog page.
          </p>
        </div>

        {/* Extension popup preview */}
        <div className="relative">
          {/* Glow effect behind the popup */}
          <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-3xl scale-105 pointer-events-none" />
          
          <div className="relative z-10">
            <ExtensionPopup />
          </div>
        </div>

        {/* Instructions */}
        <div className="text-center space-y-2 max-w-sm">
          <p className="text-xs text-slate-400">
            Click <span className="text-white font-medium">Refresh</span> to generate AI recommendations
            for the detected catalog fields.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
