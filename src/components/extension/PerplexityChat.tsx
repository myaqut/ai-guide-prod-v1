import { useState, useRef, useEffect } from "react";
import { Send, ArrowLeft, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
  relatedQuestions?: string[];
}

interface PerplexityChatProps {
  onBack: () => void;
}

export const PerplexityChat = ({ onBack }: PerplexityChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [domainFilter, setDomainFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Prepare messages for API (convert to expected format)
      const apiMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Parse domain filter if provided
      const domains = domainFilter.trim() 
        ? domainFilter.split(',').map(d => d.trim()).filter(Boolean)
        : undefined;

      const { data, error } = await supabase.functions.invoke('perplexity-chat', {
        body: { 
          messages: apiMessages,
          domainFilter: domains,
        },
      });

      if (error) {
        throw new Error(error.message || 'Failed to get response');
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.content,
        citations: data.citations,
        relatedQuestions: data.relatedQuestions,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
      // Remove the user message if request failed
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleRelatedQuestion = (question: string) => {
    setInput(question);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[500px] bg-background rounded-lg border border-border shadow-lg overflow-hidden" style={{ width: '360px' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-8 w-8 p-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Research Chat</h2>
            <p className="text-[10px] text-muted-foreground">Powered by Perplexity</p>
          </div>
        </div>
      </div>

      {/* Domain Filter */}
      <div className="px-3 py-2 border-b border-border bg-muted/30">
        <Input
          placeholder="Filter domains (e.g., microsoft.com, oracle.com)"
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="h-7 text-xs"
        />
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">Research Assistant</h3>
            <p className="text-xs text-muted-foreground max-w-[200px]">
              Ask any question about software, vendors, lifecycle dates, or technical documentation.
            </p>
            <div className="mt-4 space-y-2 w-full">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Try asking:</p>
              {[
                "What is the end of life date for Java 11?",
                "Compare MongoDB vs PostgreSQL",
                "What SSO providers does Salesforce support?",
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleRelatedQuestion(suggestion)}
                  className="w-full text-left text-xs px-3 py-2 rounded-md bg-muted hover:bg-muted/80 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        components={{
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              {children}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ),
                          p: ({ children }) => (
                            <p className="text-xs leading-relaxed mb-2 last:mb-0">{children}</p>
                          ),
                          ul: ({ children }) => (
                            <ul className="text-xs list-disc list-inside mb-2">{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="text-xs list-decimal list-inside mb-2">{children}</ol>
                          ),
                          li: ({ children }) => (
                            <li className="mb-1">{children}</li>
                          ),
                          h1: ({ children }) => (
                            <h1 className="text-sm font-bold mb-2">{children}</h1>
                          ),
                          h2: ({ children }) => (
                            <h2 className="text-sm font-semibold mb-2">{children}</h2>
                          ),
                          h3: ({ children }) => (
                            <h3 className="text-xs font-semibold mb-1">{children}</h3>
                          ),
                          code: ({ children }) => (
                            <code className="text-[10px] bg-background/50 px-1 py-0.5 rounded">{children}</code>
                          ),
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                      
                      {/* Citations */}
                      {message.citations && message.citations.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <p className="text-[10px] text-muted-foreground mb-1">Sources:</p>
                          <div className="flex flex-wrap gap-1">
                            {message.citations.slice(0, 5).map((url, i) => (
                              <a
                                key={i}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 bg-primary/10 px-1.5 py-0.5 rounded"
                              >
                                [{i + 1}]
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Related Questions */}
                      {message.relatedQuestions && message.relatedQuestions.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <p className="text-[10px] text-muted-foreground mb-1">Related:</p>
                          <div className="space-y-1">
                            {message.relatedQuestions.slice(0, 3).map((q, i) => (
                              <button
                                key={i}
                                onClick={() => handleRelatedQuestion(q)}
                                className="text-[10px] text-left text-primary hover:underline block"
                              >
                                → {q}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
            
            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Searching...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border bg-card">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a research question..."
            disabled={isLoading}
            className="flex-1 h-9 text-sm"
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            size="sm"
            className="h-9 w-9 p-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
