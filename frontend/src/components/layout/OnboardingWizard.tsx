"use client";

import { useState, useEffect } from "react";
import { connectorsAPI } from "@/lib/api/connectors";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, ServerOff, Play, Download } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export function OnboardingWizard({ children }: { children: React.ReactNode }) {
  const [isOllamaHealthy, setIsOllamaHealthy] = useState<boolean | null>(null);
  const [isOllamaInstalled, setIsOllamaInstalled] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [isActionPending, setIsActionPending] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState<string>('');

  const checkSystem = async () => {
    setIsChecking(true);
    let healthy = false;
    let installed = false;
    try {
      if (window.atlasElectron && window.atlasElectron.checkOllamaHealth) {
        const healthStatus = await window.atlasElectron.checkOllamaHealth();
        if (healthStatus.available && window.atlasElectron.verifyOllamaInference) {
          healthy = await window.atlasElectron.verifyOllamaInference();
        }
      } else {
        const res = await fetch("http://127.0.0.1:11434/", { method: "GET" });
        if (res.ok) {
          try {
            const tagsRes = await fetch("http://127.0.0.1:11434/api/tags");
            const tagsData = await tagsRes.json();
            if (tagsData.models && tagsData.models.length > 0) {
              const modelNames = tagsData.models.map((m: any) => m.name);
              const chatModel = modelNames.includes("llama3:8b") 
                ? "llama3:8b" 
                : (modelNames.find((m: string) => !m.includes('embed')) || modelNames[0]);

              const chatRes = await fetch("http://127.0.0.1:11434/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: chatModel,
                  messages: [{ role: "user", content: "ping" }],
                  stream: false
                })
              });
              healthy = chatRes.ok;
            }
          } catch {
            healthy = false;
          }
        }
      }
    } catch {
      healthy = false;
    }
    
    setIsOllamaHealthy(healthy);

    if (!healthy && window.atlasElectron && window.atlasElectron.checkOllamaInstalled) {
      installed = await window.atlasElectron.checkOllamaInstalled();
      setIsOllamaInstalled(installed);
    }

    try {
      // Check integrations for future use or side-effects, 
      // but only strictly gate on Ollama for this step.
      await connectorsAPI.listConnectors();
    } catch {
      // ignore
    }
    
    setIsChecking(false);
  };

  useEffect(() => {
    checkSystem();
  }, []);

  const handleStartOllama = async () => {
    setIsActionPending(true);
    setCheckingStatus('Starting...');
    try {
      // Check if Ollama is already running before attempting to spawn it.
      const preCheck = await window.atlasElectron?.checkOllamaHealth();
      if (preCheck?.available) {
        // Ollama is already up — skip the daemon start and go straight to
        // inference verification, which may still need the model warm-up.
        setCheckingStatus('Loading model into memory...');
        if (window.atlasElectron?.verifyOllamaInference) {
          const inferenceOk = await window.atlasElectron.verifyOllamaInference();
          if (inferenceOk) {
            setIsOllamaHealthy(true);
            setIsActionPending(false);
            setCheckingStatus('');
            return;
          }
        }
      } else if (window.atlasElectron?.startOllama) {
        await window.atlasElectron.startOllama();
      }

      // Poll: 40 attempts × 3s = 120s total coverage (accounts for cold model load).
      let attempts = 0;
      let isCheckingStatus = false;
      const interval = setInterval(async () => {
        if (isCheckingStatus) return;
        isCheckingStatus = true;
        attempts++;

        // Update status message as time passes.
        if (attempts > 5 && attempts <= 15) {
          setCheckingStatus('Loading model into memory...');
        } else if (attempts > 15) {
          setCheckingStatus('Warming up model... (30–60s)');
        }

        try {
          const healthStatus = await window.atlasElectron?.checkOllamaHealth();
          if (healthStatus?.available && window.atlasElectron?.verifyOllamaInference) {
            const inferenceOk = await window.atlasElectron.verifyOllamaInference();
            if (inferenceOk) {
              clearInterval(interval);
              setIsOllamaHealthy(true);
              setIsActionPending(false);
              setCheckingStatus('');
            }
          }
        } catch {
          // ignore transient errors during polling
        } finally {
          isCheckingStatus = false;
        }

        if (attempts > 40) {
          clearInterval(interval);
          setIsActionPending(false);
          setCheckingStatus('');
          checkSystem();
        }
      }, 3000);
    } catch (err) {
      console.error(err);
      setIsActionPending(false);
      setCheckingStatus('');
    }
  };

  const handleInstallOllama = async () => {
    setIsActionPending(true);
    try {
      if (window.atlasElectron && window.atlasElectron.installOllama) {
        await window.atlasElectron.installOllama();
      }
      
      // Poll for installation status then health
      let attempts = 0;
      let isCheckingStatus = false;
      const interval = setInterval(async () => {
        if (isCheckingStatus) return;
        isCheckingStatus = true;
        attempts++;
        try {
          const installed = await window.atlasElectron?.checkOllamaInstalled();
          if (installed) {
            setIsOllamaInstalled(true);
            // Optionally auto-start after install, or just check health
            const healthStatus = await window.atlasElectron?.checkOllamaHealth();
            if (healthStatus?.available && window.atlasElectron?.verifyOllamaInference) {
              const inferenceOk = await window.atlasElectron.verifyOllamaInference();
              if (inferenceOk) {
                clearInterval(interval);
                setIsOllamaHealthy(true);
                setIsActionPending(false);
              }
            }
          }
        } catch {
          // ignore
        } finally {
          isCheckingStatus = false;
        }
        if (attempts > 60) {
          clearInterval(interval);
          setIsActionPending(false);
          checkSystem();
        }
      }, 3000);
    } catch (err) {
      console.error(err);
      setIsActionPending(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#09090b] text-white">
        <Spinner size="lg" className="border-white/20 border-t-white/50" />
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
              className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center"
            >
              <ServerOff className="w-8 h-8 text-red-400" />
            </motion.div>
            
            <div className="space-y-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">
                {isOllamaInstalled ? "Ollama is not running" : "Ollama is missing"}
              </h1>
              <p className="text-white/60 leading-relaxed text-sm">
                Atlas requires Ollama for local LLM inference. 
                {isOllamaInstalled ? 
                  " Please start your local Ollama daemon." : 
                  " Ollama needs to be installed on your system to continue."}
              </p>
            </div>
            
            <div className="flex flex-col gap-3 w-full mt-2">
              {isOllamaInstalled ? (
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleStartOllama}
                  disabled={isActionPending}
                  className="flex items-center justify-center gap-2 bg-white text-black px-6 py-3 rounded-xl font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  {isActionPending ? <Spinner size="sm" className="border-black/20 border-t-black" /> : <Play className="w-4 h-4" />}
                  {isActionPending ? (checkingStatus || 'Starting...') : 'Start Ollama'}
                </motion.button>
              ) : (
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleInstallOllama}
                  disabled={isActionPending}
                  className="flex items-center justify-center gap-2 bg-white text-black px-6 py-3 rounded-xl font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  {isActionPending ? <Spinner size="sm" className="border-black/20 border-t-black" /> : <Download className="w-4 h-4" />}
                  {isActionPending ? "Installing..." : "Install Ollama"}
                </motion.button>
              )}

              <button 
                onClick={checkSystem}
                disabled={isActionPending}
                className="flex items-center justify-center gap-2 text-white/50 hover:text-white text-sm py-2 disabled:opacity-50"
              >
                {isChecking ? <Spinner size="xs" /> : <RefreshCw className="w-3 h-3" />}
                {isChecking ? "Verifying model... (may take 30s)" : "Retry Connection"}
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return <>{children}</>;
}
