import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, LogIn, UserPlus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthMode = 'signin' | 'signup';

export const AuthScreen = () => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password);
        if (error) {
          console.error('Sign in error:', error);
          toast.error(error.message || 'Failed to sign in');
        } else {
          toast.success('Welcome back!');
        }
      } else {
        const { error } = await signUp(email, password);
        if (error) {
          console.error('Sign up error:', error);
          toast.error(error.message || 'Failed to sign up');
        } else {
          toast.success('Account created! Check your email to verify.');
        }
      }
    } catch (error) {
      console.error('Auth error:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background p-4">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 mb-3">
          <Sparkles className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">
          Researcher AI Assistant
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Sign in to access AI-powered research tools
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex bg-muted rounded-lg p-1 mb-6">
        <button
          type="button"
          onClick={() => setMode('signin')}
          className={cn(
            "flex-1 text-xs py-2 px-3 rounded-md transition-all duration-200 flex items-center justify-center gap-1.5",
            mode === 'signin'
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LogIn className="w-3.5 h-3.5" />
          Sign In
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          className={cn(
            "flex-1 text-xs py-2 px-3 rounded-md transition-all duration-200 flex items-center justify-center gap-1.5",
            mode === 'signup'
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <UserPlus className="w-3.5 h-3.5" />
          Sign Up
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-col flex-1">
        <div className="space-y-4 flex-1">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 text-sm"
              disabled={isSubmitting}
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 text-sm"
              disabled={isSubmitting}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full h-10 mt-6"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {mode === 'signin' ? 'Signing in...' : 'Creating account...'}
            </>
          ) : (
            <>
              {mode === 'signin' ? (
                <>
                  <LogIn className="w-4 h-4 mr-2" />
                  Sign In
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Create Account
                </>
              )}
            </>
          )}
        </Button>
      </form>

      {/* Footer */}
      <p className="text-[10px] text-muted-foreground text-center mt-4">
        By continuing, you agree to our terms of service
      </p>
    </div>
  );
};
