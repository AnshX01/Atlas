"use client";

import { useState, useEffect } from "react";
import { connectorsAPI } from "@/lib/api/connectors";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, ServerOff } from "lucide-react";

export function OnboardingWizard({ children }: { children: React.ReactNode }) {
  const [isOllamaHealthy, setIsOllamaHealthy] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  const checkHealth = async () => {
    setIsChecking(true);
    try {
      // Check Ollama health
      const res = await fetch("http://127.0.0.1:11434/", { method: "GET" });
      setIsOllamaHealthy(res.ok);
    } catch {
      setIsOllamaHealthy(false);
    }

    try {
      // We check integrations for future use or side-effects, 
      // but only strictly gate on Ollama for this step.
      await connectorsAPI.listConnectors();
    } catch {
      // ignore
    }
    
    setIsChecking(false);
  };

  useEffect(() => {
    checkHealth();
  }, []);

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#09090b] text-white">
        <RefreshCw className="w-8 h-8 animate-spin text-white/50" />
      </div>
    );
  }

  if (isOllamaHealthy === false) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#09090b] relative overflow-hidden">
        {/* Background glow for aesthetic */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-500/10 rounded-full blur-[120px] pointer-events-none" />
        
        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="glass-panel max-w-md w-full p-8 text-center flex flex-col items-center gap-6 relative z-10"
          >
            <motion.div 
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 500 }}
              className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.2)]"
            >
              <ServerOff className="w-8 h-8 text-red-400" />
            </motion.div>
            
            <div className="space-y-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">Ollama is not running</h1>
              <p className="text-white/60 leading-relaxed text-sm">
                Atlas requires Ollama for local LLM inference. Please start Ollama and ensure it's accessible at <code className="bg-white/10 px-1.5 py-0.5 rounded text-white/90 text-xs font-mono ml-1">http://127.0.0.1:11434</code>
              </p>
            </div>
            
            <motion.button 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={checkHealth}
              className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl font-medium hover:bg-white/90 transition-colors shadow-lg mt-2"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Connection
            </motion.button>
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return <>{children}</>;
}
