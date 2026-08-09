import { useState, useCallback, useRef, useEffect } from "react";

export function useSpeechToText() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const manuallyStoppedRef = useRef<boolean>(false);

  const startListening = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      console.warn("Speech recognition is not supported in this browser.");
      return;
    }
    
    if (isListening) return;

    manuallyStoppedRef.current = false;
    setTranscript('');
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    
    recognitionRef.current.onresult = (event: any) => {
      let currentTranscript = '';
      for (let i = 0; i < event.results.length; ++i) {
        currentTranscript += event.results[i][0].transcript;
      }
      setTranscript(currentTranscript);
    };

    recognitionRef.current.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
         manuallyStoppedRef.current = true;
      }
    };

    recognitionRef.current.onend = () => {
      if (!manuallyStoppedRef.current) {
        // Auto-restart if browser stopped it due to a pause, ensuring continuous dictation
        try {
          recognitionRef.current.start();
        } catch (e) {
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
    };

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      console.error(e);
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    manuallyStoppedRef.current = true;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      manuallyStoppedRef.current = true;
      if (recognitionRef.current) {
         recognitionRef.current.stop();
      }
    };
  }, []);

  return { isListening, transcript, toggleListening, startListening, stopListening };
}
