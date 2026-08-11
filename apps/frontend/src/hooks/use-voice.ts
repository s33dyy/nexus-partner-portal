import { useCallback, useEffect, useRef, useState } from "react";

// Wraps the browser's native Web Speech API — speechSynthesis for "tell me"
// (standard DOM lib, no shim needed) and SpeechRecognition for "ask" (a
// non-standard API declared in src/types/speech-recognition.d.ts). Both are
// feature-detected: Chrome/Edge/Safari support both; Firefox lacks
// SpeechRecognition, so canListen is false there and callers should disable
// the mic control rather than call listen(). Deliberately browser-only, no
// server dependency — this is the free-tier voice experience; a paid neural
// TTS provider (OpenAI TTS, ElevenLabs, etc.) is the only way past its
// quality ceiling, and was deliberately not added without the user opting
// into the new cost/vendor/API-key it requires.

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
// natural "Tell me" sounds, at zero cost and no new dependency. Whether a
// genuinely better voice is actually AVAILABLE to pick still depends on the
// device: Chrome usually ships a couple of "Google ..." network voices;
// macOS needs "Enhanced"/"Premium" voices manually downloaded via System
// Settings → Accessibility → Spoken Content → System Voice → Manage Voices
// before they show up here at all — this function can't create one that
// isn't installed, only prefer it once it is.
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

// One long utterance often reads as a single flat monotone run — most
// engines give each SpeechSynthesisUtterance its own short intonation
// contour, so speaking sentence-by-sentence (queued back to back, with the
// small natural gap between utterances acting as a breath/pause) sounds
// noticeably less robotic than the same text as one giant utterance, at
// zero cost. Falls back to the whole text as one "sentence" if it doesn't
// look like normal punctuated prose.
function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  const matches = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)/g);
  if (!matches) return [trimmed];
  const sentences = matches.map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.length > 0 ? sentences : [trimmed];
}

export function useVoice(): UseVoiceResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const canListen = getRecognitionConstructor() !== null;

  useEffect(() => {
    if (!canSpeak) return;
    // Chrome loads its voice list asynchronously, and only starts once
    // getVoices() has been called at least once. Calling it here on mount
    // means the list is very likely populated by the time the user
    // actually clicks a voice control a moment later — speak() below
    // re-queries fresh rather than trusting a value cached at this point,
    // so this call exists purely to kick off that loading early.
    window.speechSynthesis.getVoices();
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

      const voice = pickBestVoice(window.speechSynthesis.getVoices());
      const sentences = splitIntoSentences(text);
      let pending = sentences.length;

      sentences.forEach((sentence) => {
        const utterance = new SpeechSynthesisUtterance(sentence);
        if (voice) utterance.voice = voice;
        utterance.onstart = () => setIsSpeaking(true);
        const settle = () => {
          pending -= 1;
          if (pending <= 0) setIsSpeaking(false);
        };
        utterance.onend = settle;
        utterance.onerror = settle;
        window.speechSynthesis.speak(utterance);
      });
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
