"use client";

import { useState, useEffect, useRef } from "react";
import { connectorsAPI } from "@/lib/api/connectors";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, ServerOff, Play, Download } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export function OnboardingWizard({ children }: { children: React.ReactNode }) {
  const [isOllamaHealthy, setIsOllamaHealthy] = useState<boolean | null>(null);
  const [isOllamaInstalled, setIsOllamaInstalled] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState<string>("");
  const [showBanner, setShowBanner] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const checkSystem = async () => {
    setIsChecking(true);
    let healthy = false;
    let installed = false;
    try {
      if (window.atlasElectron && window.atlasElectron.checkOllamaHealth) {
        const healthStatus = await window.atlasElectron.checkOllamaHealth();
        healthy = Boolean(healthStatus?.available);
      } else {
        try {
          const res = await fetch("http://127.0.0.1:11434/", {
            method: "GET",
            signal: AbortSignal.timeout(3000),
          });
          healthy = res.ok;
        } catch {
          healthy = false;
        }
      }
    } catch {
      healthy = false;
    }

    setIsOllamaHealthy(healthy);

    if (!healthy && window.atlasElectron && window.atlasElectron.checkOllamaInstalled) {
      try {
        installed = await window.atlasElectron.checkOllamaInstalled();
        setIsOllamaInstalled(installed);
      } catch {
        setIsOllamaInstalled(false);
      }
    }

    try {
      await connectorsAPI.listConnectors();
    } catch {
      // ignore
    }

    setIsChecking(false);
    setShowBanner(!healthy);
  };

  useEffect(() => {
    // Run the Ollama check in the background after the app loads
    const timer = setTimeout(() => {
      checkSystem();
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartOllama = async () => {
    setIsActionPending(true);
    setCheckingStatus("Starting Ollama...");
    try {
      const preCheck = await window.atlasElectron?.checkOllamaHealth();
      if (preCheck?.available) {
        setIsOllamaHealthy(true);
        setShowBanner(false);
        setIsActionPending(false);
        setCheckingStatus("");
        return;
      }

      if (window.atlasElectron?.startOllama) {
        await window.atlasElectron.startOllama();
      }

      let attempts = 0;
      let isCheckingStatus = false;
      const interval = setInterval(async () => {
        if (isCheckingStatus) return;
        isCheckingStatus = true;
        attempts++;

        try {
          const healthStatus = await window.atlasElectron?.checkOllamaHealth();
          if (healthStatus?.available) {
            clearInterval(interval);
            setIsOllamaHealthy(true);
            setShowBanner(false);
            setIsActionPending(false);
            setCheckingStatus("");
          }
        } catch {
          // ignore
        } finally {
          isCheckingStatus = false;
        }

        if (attempts > 20) {
          clearInterval(interval);
          setIsActionPending(false);
          setCheckingStatus("");
          checkSystem();
        }
      }, 1500);
      pollIntervalRef.current = interval;
    } catch (err) {
      console.error(err);
      setIsActionPending(false);
      setCheckingStatus("");
    }
  };

  const handleInstallOllama = async () => {
    setIsActionPending(true);
    setCheckingStatus("Installing Ollama...");
    try {
      if (window.atlasElectron && window.atlasElectron.installOllama) {
        await window.atlasElectron.installOllama();
      }

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
            const healthStatus = await window.atlasElectron?.checkOllamaHealth();
            if (healthStatus?.available) {
              clearInterval(interval);
              setIsOllamaHealthy(true);
              setShowBanner(false);
              setIsActionPending(false);
              setCheckingStatus("");
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
          setCheckingStatus("");
          checkSystem();
        }
      }, 2000);
      pollIntervalRef.current = interval;
    } catch (err) {
      console.error(err);
      setIsActionPending(false);
      setCheckingStatus("");
    }
  };

  return (
    <>
      {children}

      <AnimatePresence>
        {showBanner && !isOllamaHealthy && (
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed bottom-4 right-4 z-50 max-w-sm w-full"
          >
            <div
              className="rounded-2xl p-4 shadow-2xl"
              style={{
                background: "rgba(17, 17, 19, 0.95)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
              }}
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <ServerOff className="w-4 h-4 text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white mb-0.5">
                    {isOllamaInstalled === false ? "Ollama not installed" : "Ollama not running"}
                  </p>
                  <p className="text-xs text-white/50 leading-relaxed">
                    AI features require Ollama. The app works, but AI Chat won&apos;t respond.
                  </p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {isOllamaInstalled === false ? (
                      <button
                        onClick={handleInstallOllama}
                        disabled={isActionPending}
                        className="flex items-center gap-1.5 bg-white text-black px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                      >
                        {isActionPending ? (
                          <Spinner size="xs" className="border-black/20 border-t-black" />
                        ) : (
                          <Download className="w-3 h-3" />
                        )}
                        {isActionPending ? "Installing..." : "Install"}
                      </button>
                    ) : (
                      <button
                        onClick={handleStartOllama}
                        disabled={isActionPending}
                        className="flex items-center gap-1.5 bg-white text-black px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                      >
                        {isActionPending ? (
                          <Spinner size="xs" className="border-black/20 border-t-black" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        {isActionPending ? checkingStatus || "Starting..." : "Start Ollama"}
                      </button>
                    )}
                    <button
                      onClick={checkSystem}
                      disabled={isActionPending || isChecking}
                      className="flex items-center gap-1.5 text-white/40 hover:text-white/70 px-2 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50"
                    >
                      {isChecking ? <Spinner size="xs" /> : <RefreshCw className="w-3 h-3" />}
                      Retry
                    </button>
                    <button
                      onClick={() => setShowBanner(false)}
                      className="ml-auto text-white/30 hover:text-white/60 px-2 py-1.5 rounded-lg text-xs transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
