import { useState, useRef, useEffect } from "react";
import { Send, ArrowLeft, Loader2, ExternalLink, Sparkles, Globe, Copy, Check, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
  relatedQuestions?: string[];
}

interface PerplexityChatProps {
  onBack?: () => void;
  embedded?: boolean; // When true, fits within parent container without its own chrome
  messages?: ChatMessage[];
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

// Animated typing dots
const TypingIndicator = () => (
  <div className="flex items-center gap-1.5 px-3 py-2">
    <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
    <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
    <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
  </div>
);

// Citation badge component
const CitationBadge = ({ url, index }: { url: string; index: number }) => {
  const [copied, setCopied] = useState(false);
  
  const hostname = (() => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return 'source';
    }
  })();

  const copyUrl = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1 text-[10px] bg-gradient-to-r from-primary/10 to-primary/5 hover:from-primary/20 hover:to-primary/10 text-primary px-2 py-1 rounded-full transition-all duration-200 hover:shadow-sm border border-primary/10"
    >
      <span className="font-medium">[{index + 1}]</span>
      <span className="max-w-[80px] truncate opacity-70 group-hover:opacity-100">{hostname}</span>
      <button
        onClick={copyUrl}
        className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
      >
        {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
      </button>
    </a>
  );
};

// Message bubble component
const MessageBubble = ({ 
  message, 
  index, 
  onRelatedQuestion 
}: { 
  message: ChatMessage; 
  index: number;
  onRelatedQuestion: (q: string) => void;
}) => {
  const isUser = message.role === 'user';
  
  return (
    <div
      className={cn(
        "flex animate-fade-in",
        isUser ? "justify-end" : "justify-start"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm transition-all duration-200",
          isUser
            ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground rounded-br-md"
            : "bg-card border border-border rounded-bl-md"
        )}
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
                    className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
                  >
                    {children}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ),
                p: ({ children }) => (
                  <p className="text-xs leading-relaxed mb-2 last:mb-0 text-foreground">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="text-xs list-disc list-inside mb-2 space-y-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="text-xs list-decimal list-inside mb-2 space-y-1">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="text-foreground">{children}</li>
                ),
                h1: ({ children }) => (
                  <h1 className="text-sm font-bold mb-2 text-foreground">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-sm font-semibold mb-2 text-foreground">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xs font-semibold mb-1 text-foreground">{children}</h3>
                ),
                code: ({ children }) => (
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{children}</code>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-foreground">{children}</strong>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
            
            {/* Citations */}
            {message.citations && message.citations.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  Sources
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {message.citations.slice(0, 5).map((url, i) => (
                    <CitationBadge key={i} url={url} index={i} />
                  ))}
                </div>
              </div>
            )}

            {/* Related Questions */}
            {message.relatedQuestions && message.relatedQuestions.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  Related questions
                </p>
                <div className="space-y-1.5">
                  {message.relatedQuestions.slice(0, 3).map((q, i) => (
                    <button
                      key={i}
                      onClick={() => onRelatedQuestion(q)}
                      className="text-[11px] text-left text-primary hover:text-primary/80 flex items-center gap-1.5 group transition-colors"
                    >
                      <span className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center text-[9px] group-hover:bg-primary/20 transition-colors">
                        →
                      </span>
                      <span className="group-hover:underline">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs font-medium">{message.content}</p>
        )}
      </div>
    </div>
  );
};

// Suggestion card
const SuggestionCard = ({ text, onClick, delay }: { text: string; onClick: () => void; delay: number }) => (
  <button
    onClick={onClick}
    className="w-full text-left text-xs px-4 py-3 rounded-xl bg-gradient-to-r from-muted/80 to-muted/40 hover:from-muted hover:to-muted/60 border border-border/50 hover:border-primary/30 transition-all duration-200 hover:shadow-md animate-fade-in group"
    style={{ animationDelay: `${delay}ms` }}
  >
    <span className="text-muted-foreground group-hover:text-foreground transition-colors">{text}</span>
  </button>
);

export const PerplexityChat = ({ onBack, embedded = false, messages: externalMessages, onMessagesChange }: PerplexityChatProps) => {
  // Use external state if provided, otherwise fall back to internal state
  const [internalMessages, setInternalMessages] = useState<ChatMessage[]>([]);
  const messages = externalMessages ?? internalMessages;
  const setMessages = onMessagesChange ?? setInternalMessages;
  
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [domainFilter, setDomainFilter] = useState("");
  const [showDomainFilter, setShowDomainFilter] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

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
      const apiMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

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

  const suggestions = [
    "What is the end of life date for Java 11?",
    "Compare MongoDB vs PostgreSQL for enterprise",
    "What SSO providers does Salesforce support?",
  ];

  // Embedded mode - no header, fits within parent
  if (embedded) {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-background">
        {/* Compact domain filter toggle */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-foreground">Research Chat</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDomainFilter(!showDomainFilter)}
            className={cn(
              "h-6 px-2 text-[10px] gap-1 transition-colors",
              showDomainFilter || domainFilter ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Globe className="h-3 w-3" />
            Filter
          </Button>
        </div>

        {/* Domain Filter (Collapsible) */}
        <div className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          showDomainFilter ? "max-h-14 opacity-100" : "max-h-0 opacity-0"
        )}>
          <div className="px-3 py-2 border-b border-border bg-muted/30">
            <Input
              placeholder="Filter to domains: microsoft.com, oracle.com"
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="h-7 text-xs bg-background/80"
            />
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-2 animate-fade-in">
              <div className="relative mb-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20">
                  <Sparkles className="w-7 h-7 text-primary" />
                </div>
              </div>
              
              <h3 className="text-sm font-semibold text-foreground mb-1">Research Assistant</h3>
              <p className="text-xs text-muted-foreground max-w-[200px] mb-4">
                Ask about software, vendors, lifecycle dates, or technical docs.
              </p>
              
              <div className="w-full space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">
                  Try asking
                </p>
                {suggestions.map((suggestion, i) => (
                  <SuggestionCard
                    key={i}
                    text={suggestion}
                    onClick={() => handleRelatedQuestion(suggestion)}
                    delay={i * 100}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => (
                <MessageBubble
                  key={index}
                  message={message}
                  index={index}
                  onRelatedQuestion={handleRelatedQuestion}
                />
              ))}
              
              {isLoading && (
                <div className="flex justify-start animate-fade-in">
                  <div className="bg-card border border-border rounded-2xl rounded-bl-md shadow-sm">
                    <TypingIndicator />
                  </div>
                </div>
              )}
              
              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>

        {/* Input */}
        <div className="p-3 border-t border-border bg-card/50">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a research question..."
              disabled={isLoading}
              className="flex-1 h-9 text-sm rounded-xl bg-background border-border/50 focus:border-primary/50 transition-colors"
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              size="sm"
              className="h-9 w-9 p-0 rounded-xl bg-gradient-to-br from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-md transition-all duration-200 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Standalone mode - full chrome with header
  return (
    <div className="flex flex-col h-[500px] bg-background rounded-xl border border-border shadow-xl overflow-hidden animate-scale-in" style={{ width: '360px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-card to-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="h-8 w-8 p-0 hover:bg-muted/80 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-success rounded-full border-2 border-card" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Research Chat</h2>
              <p className="text-[10px] text-muted-foreground">Powered by Perplexity AI</p>
            </div>
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDomainFilter(!showDomainFilter)}
          className={cn(
            "h-7 px-2 text-[10px] gap-1 transition-colors",
            showDomainFilter || domainFilter ? "text-primary" : "text-muted-foreground"
          )}
        >
          <Globe className="h-3 w-3" />
          Filter
        </Button>
      </div>

      {/* Domain Filter (Collapsible) */}
      <div className={cn(
        "overflow-hidden transition-all duration-200 ease-out",
        showDomainFilter ? "max-h-14 opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <Input
            placeholder="Filter to domains: microsoft.com, oracle.com"
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="h-7 text-xs bg-background/80"
          />
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-2 animate-fade-in">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-success rounded-full flex items-center justify-center border-2 border-background">
                <Check className="w-3 h-3 text-success-foreground" />
              </div>
            </div>
            
            <h3 className="text-base font-semibold text-foreground mb-1">Research Assistant</h3>
            <p className="text-xs text-muted-foreground max-w-[220px] mb-5">
              Ask any question about software, vendors, lifecycle dates, or technical documentation.
            </p>
            
            <div className="w-full space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
                Try asking
              </p>
              {suggestions.map((suggestion, i) => (
                <SuggestionCard
                  key={i}
                  text={suggestion}
                  onClick={() => handleRelatedQuestion(suggestion)}
                  delay={i * 100}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <MessageBubble
                key={index}
                message={message}
                index={index}
                onRelatedQuestion={handleRelatedQuestion}
              />
            ))}
            
            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start animate-fade-in">
                <div className="bg-card border border-border rounded-2xl rounded-bl-md shadow-sm">
                  <TypingIndicator />
                </div>
              </div>
            )}
            
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border bg-gradient-to-r from-card to-card/80">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a research question..."
            disabled={isLoading}
            className="flex-1 h-10 text-sm rounded-xl bg-background/80 border-border/50 focus:border-primary/50 transition-colors"
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            size="sm"
            className="h-10 w-10 p-0 rounded-xl bg-gradient-to-br from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-md transition-all duration-200 hover:shadow-lg disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
