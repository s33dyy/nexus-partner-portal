import { useCallback, useEffect, useRef, useState } from "react";

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

// SpeechRecognition's error codes are technical (see the Web Speech API
// spec) and were previously surfaced to users verbatim — e.g. a bare
// "network" toast when the browser's speech backend couldn't be reached.
// "aborted" is deliberately not mapped to an error message: it fires when
// listen() itself calls recognition.abort() to replace an in-flight
// recognition, which is expected cleanup, not a user-facing failure.
function describeRecognitionError(code: string): string | null {
  switch (code) {
    case "network":
      return "Couldn't reach the voice service — check your internet connection and try again.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow microphone access for this site and try again.";
    case "no-speech":
      return "Didn't hear anything — try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "aborted":
      return null;
    default:
      return "Voice input failed — try again.";
  }
}

// Browser TTS voices vary enormously in quality — the plain unselected
// default is often the flattest, most "robotic"-sounding option a platform
// ships. Preferring a higher-quality voice by name pattern (every major
// platform labels its better voices this way) meaningfully improves how
// natural "Tell me" sounds, at zero cost and no new dependency.
function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const pool = english.length > 0 ? english : voices;
  const byPattern = (pattern: RegExp) => pool.find((voice) => pattern.test(voice.name));
  return (
    byPattern(/natural/i) ??
    byPattern(/enhanced|premium/i) ??
    byPattern(/^google/i) ??
    byPattern(/online/i) ??
    pool[0]
  );
}

export function useVoice(): UseVoiceResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const canListen = getRecognitionConstructor() !== null;

  useEffect(() => {
    if (!canSpeak) return;
    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, [canSpeak]);

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
      const voice = pickBestVoice(voicesRef.current);
      if (voice) utterance.voice = voice;
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
        const message = describeRecognitionError(event.error);
        if (message) {
          reject(new Error(message));
        } else {
          resolve("");
        }
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
