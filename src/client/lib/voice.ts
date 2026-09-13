export interface VoicePreflightResult {
  ttsAvailable: boolean;
  localAsrAvailable: boolean;
  cloudAsrEligible: boolean;
  voiceCapable: boolean;
  reason?: string;
}

export async function preflightTTS(): Promise<boolean> {
  if (typeof speechSynthesis === "undefined") return false;
  try {
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      await new Promise((r) => setTimeout(r, 500));
      return speechSynthesis.getVoices().length > 0;
    }
    return true;
  } catch {
    return false;
  }
}

export async function preflightLocalASR(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const SpeechRecognition =
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  if (!SpeechRecognition) return false;

  return new Promise((resolve) => {
    try {
      const recognition = new (SpeechRecognition as new () => {
        start: () => void;
        stop: () => void;
        onerror: ((e: unknown) => void) | null;
        onresult: ((e: unknown) => void) | null;
        onend: (() => void) | null;
        continuous: boolean;
        interimResults: boolean;
      })();
      recognition.continuous = false;
      recognition.interimResults = false;
      let settled = false;
      const done = (val: boolean) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };
      recognition.onresult = () => done(true);
      recognition.onerror = () => done(false);
      recognition.onend = () => done(false);
      recognition.start();
      setTimeout(() => {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
        done(false);
      }, 3000);
    } catch {
      resolve(false);
    }
  });
}

export async function preflightVoice(
  cloudAsrEligible: boolean = false
): Promise<VoicePreflightResult> {
  const ttsAvailable = await preflightTTS();
  const localAsrAvailable = await preflightLocalASR();
  const voiceCapable = ttsAvailable && (localAsrAvailable || cloudAsrEligible);

  let reason: string | undefined;
  if (!voiceCapable) {
    if (!ttsAvailable) reason = "TTS unavailable";
    else if (!localAsrAvailable && !cloudAsrEligible)
      reason = "No ASR available (local or cloud)";
  }

  return {
    ttsAvailable,
    localAsrAvailable,
    cloudAsrEligible,
    voiceCapable,
    reason
  };
}

export interface TTSController {
  speak: (text: string) => void;
  stop: () => void;
  isSpeaking: () => boolean;
}

export function createTTSController(): TTSController {
  let speaking = false;

  return {
    speak(text: string) {
      this.stop();
      if (typeof speechSynthesis === "undefined" || !text) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => {
        speaking = true;
      };
      utterance.onend = () => {
        speaking = false;
      };
      utterance.onerror = () => {
        speaking = false;
      };
      speechSynthesis.speak(utterance);
    },
    stop() {
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
      }
      speaking = false;
    },
    isSpeaking() {
      return speaking;
    }
  };
}
