import { useEffect, useRef, useState, useCallback } from "react";

// @ts-ignore
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export type VoiceHighlight = {
  id: string;
  text: string;
  color: string;
  box: { left: number; top: number; width: number; height: number };
};

export type VoiceStatus =
  | "idle"
  | "listening"
  | "recognizing"
  | "executed"
  | "not_recognized"
  | "permission_denied"
  | "error";

type UseVoiceControlProps = {
  enabled: boolean;
  onNext: () => void;
  onPrev: () => void;
  onGoToSlide: (slide: number) => void;
  onHighlight: (text: string, color: string) => void;
  onRemoveHighlight: (text: string) => void;
  onClearHighlights: () => void;
  onGoToSlideByText: (text: string) => void;
};

export function useVoiceControl({
  enabled,
  onNext,
  onPrev,
  onGoToSlide,
  onHighlight,
  onRemoveHighlight,
  onClearHighlights,
  onGoToSlideByText,
}: UseVoiceControlProps) {
  const [isListening, setIsListening] = useState(false);
  const [supported] = useState(!!SpeechRecognition);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const processCommand = useCallback(
    (command: string): boolean => {
      // Normalize punctuation and extra spaces
      const lower = command.toLowerCase().replace(/[.,!?;:]/g, "").replace(/\s+/g, " ").trim();

      // Navigation: "next slide"
      if (lower.includes("next slide")) {
        onNext();
        return true;
      }

      // Navigation: "previous slide" / "last slide" / "prev slide"
      if (
        lower.includes("previous slide") ||
        lower.includes("last slide") ||
        lower.includes("prev slide")
      ) {
        onPrev();
        return true;
      }

      // Words to digits map for slide numbers
      const wordsToNum: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
      };

      // Go to slide by number: "go to slide 4" OR "slide four"
      const slideMatch = lower.match(/(?:go to )?slide (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/);
      if (slideMatch) {
        const val = slideMatch[1];
        const num = isNaN(Number(val)) ? wordsToNum[val] : parseInt(val, 10);
        onGoToSlide(num - 1); // 0-indexed
        return true;
      }

      // Go to slide by title text: "go to the introduction slide"
      const textSlideMatch = lower.match(/go to the (.+?) slide/);
      if (textSlideMatch) {
        onGoToSlideByText(textSlideMatch[1].trim());
        return true;
      }

      // Clear all highlights
      if (lower.includes("clear highlights") || lower.includes("clear all highlights")) {
        onClearHighlights();
        return true;
      }

      // Remove specific highlight: "remove highlight india"
      const removeMatch = lower.match(/remove highlight\s+(.+)/);
      if (removeMatch) {
        onRemoveHighlight(removeMatch[1].trim());
        return true;
      }

      // Highlight with color: "highlight india in red"
      const colorMatch = lower.match(/highlight\s+(.+?)\s+in\s+(yellow|red|green|blue)/);
      if (colorMatch) {
        onHighlight(colorMatch[1].trim(), colorMatch[2].trim());
        return true;
      }

      // Default highlight: "highlight india"
      const highlightMatch = lower.match(/highlight\s+(.+)/);
      if (highlightMatch) {
        onHighlight(highlightMatch[1].trim(), "yellow");
        return true;
      }

      // NOTE: Laser is intentionally EXCLUDED from voice commands.
      // Laser is controlled by hand gestures only (index finger).

      return false; // command not recognized
    },
    [onNext, onPrev, onGoToSlide, onGoToSlideByText, onHighlight, onRemoveHighlight, onClearHighlights]
  );

  useEffect(() => {
    if (!supported || !enabled) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) { }
      }
      setIsListening(false);
      setStatus("idle");
      setTranscript("");
      return;
    }

    // Create recognition instance once
    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true; // get partial results as user speaks
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setStatus("listening");
      };

      recognition.onresult = (event: any) => {
        // Show interim (partial) transcript as user speaks
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        // Show what's being said in real time
        const currentSpeech = finalTranscript || interimTranscript;
        if (currentSpeech) {
          setTranscript(currentSpeech);
          setStatus("recognizing");
        }

        // Only process final results as commands
        if (finalTranscript.trim()) {
          const executed = processCommand(finalTranscript.trim());
          setStatus(executed ? "executed" : "not_recognized");
          // Return to listening after 2s
          setTimeout(() => {
            if (enabledRef.current) setStatus("listening");
          }, 2000);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech") {
          // Not an error — just silence, keep listening
          return;
        }
        if (event.error === "not-allowed" || event.error === "permission-denied") {
          setStatus("permission_denied");
          setIsListening(false);
          return;
        }
        setStatus("error");
      };

      recognition.onend = () => {
        // Auto-restart if still enabled (continuous mode)
        if (enabledRef.current) {
          try { recognition.start(); } catch (e) { }
        } else {
          setIsListening(false);
          setStatus("idle");
        }
      };

      recognitionRef.current = recognition;
    }

    // Start if not already running
    if (enabled && !isListening) {
      try {
        recognitionRef.current.start();
      } catch (e) { }
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) { }
      }
    };
  }, [enabled, supported, processCommand]);

  return {
    supported,
    isListening,
    transcript,
    status,
  };
}
