import { useCallback, useRef, useState } from "react";

// Wraps the browser's native Web Speech API — speechSynthesis for "tell me"
// (standard DOM lib, no shim needed) and SpeechRecognition for "ask" (a
// non-standard API declared in src/types/speech-recognition.d.ts). Both are
// feature-detected: Chrome/Edge/Safari support both; Firefox lacks
// SpeechRecognition, so canListen is false there and callers should disable
// the mic control rather than call listen(). Deliberately browser-only, no
// server dependency — matches how the digest's voice controls are meant to
// be a free input/output modality around the existing chat pipeline, not a
// new backend integration.

export type UseVoiceResult = {
  canSpeak: boolean;
  canListen: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  listen: () => Promise<string>;
};

function getRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function useVoice(): UseVoiceResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const canListen = getRecognitionConstructor() !== null;

  const stopSpeaking = useCallback(() => {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [canSpeak]);

  const speak = useCallback(
    (text: string) => {
      if (!canSpeak || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [canSpeak],
  );

  const listen = useCallback((): Promise<string> => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      return Promise.reject(new Error("Voice input isn't supported in this browser."));
    }
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    return new Promise<string>((resolve, reject) => {
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.lang = "en-US";

      let settled = false;

      recognition.onresult = (event) => {
        const lastResult = event.results[event.results.length - 1];
        const transcript = lastResult?.[0]?.transcript ?? "";
        settled = true;
        resolve(transcript.trim());
      };
      recognition.onerror = (event) => {
        if (settled) return;
        settled = true;
        reject(new Error(event.error || "Voice input failed"));
      };
      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
        if (!settled) {
          settled = true;
          resolve("");
        }
      };

      setIsListening(true);
      recognition.start();
    });
  }, []);

  return { canSpeak, canListen, isSpeaking, isListening, speak, stopSpeaking, listen };
}
