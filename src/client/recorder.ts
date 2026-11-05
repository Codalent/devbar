/**
 * Screen recording with the microphone: the screen, window or tab the person picks, and their
 * voice over it. Pausing pauses the recorder itself, so a paused stretch is not in the video.
 * Everything stays in the page until the toolbar uploads the finished video to the local server.
 */

export interface Recording {
  blob: Blob;
  /** The base type, `video/webm` or `video/mp4`, as the server stores it. */
  mimeType: string;
  /** Seconds of video, pauses left out. */
  duration: number;
  /** An object URL for the blob, for a preview; revoke it with `releaseRecording`. */
  url: string;
  /** Whether the microphone was heard. */
  voice: boolean;
}

export type RecorderState = "idle" | "starting" | "recording" | "paused";

const TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];

/** Why recording cannot start in this page, or null when it can. */
export function recordingUnsupported(): string | null {
  if (!window.isSecureContext) return "Screen recording needs a secure page (https or localhost).";
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") return "This browser cannot record the screen.";
  return null;
}

export function releaseRecording(recording: Recording | null): void {
  if (recording) URL.revokeObjectURL(recording.url);
}

export class ScreenRecorder {
  state: RecorderState = "idle";
  /** Called once per recording: with the video, or with null when it was discarded or empty. */
  onStop: (recording: Recording | null) => void = () => {};

  private display: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audio: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array | null = null;
  private activeMs = 0;
  private resumedAt = 0;
  private discarded = false;

  /**
   * Asks for a screen, then the microphone. Call it straight from a click or key press: browsers
   * only show the screen picker in answer to one. Throws when the picker is cancelled.
   */
  async start(): Promise<{ voice: boolean; micError?: string }> {
    if (this.state !== "idle") throw new Error("Already recording.");
    this.state = "starting";
    this.discarded = false;
    this.chunks = [];
    this.activeMs = 0;
    // Made now, while the click still counts, so the level meter is allowed to run.
    try {
      this.audio = new AudioContext();
    } catch {
      this.audio = null;
    }
    try {
      this.display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 }, displaySurface: "browser" },
        audio: false,
        // Chrome: offer this tab too, and let the person switch tabs while recording.
        selfBrowserSurface: "include",
        surfaceSwitching: "include",
      } as DisplayMediaStreamOptions);
    } catch (error) {
      this.cleanup();
      this.state = "idle";
      throw error;
    }

    let micError: string | undefined;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
      const name = (error as DOMException)?.name;
      micError = name === "NotAllowedError" ? "microphone blocked" : name === "NotFoundError" ? "no microphone found" : "microphone unavailable";
    }
    // The picker can be closed by the person, or the shared tab closed, while the mic is asked for.
    if (!this.display.getVideoTracks().some((t) => t.readyState === "live")) {
      this.cleanup();
      this.state = "idle";
      throw new DOMException("The shared screen ended.", "AbortError");
    }

    if (this.mic && this.audio) {
      try {
        void this.audio.resume();
        this.analyser = this.audio.createAnalyser();
        this.analyser.fftSize = 512;
        this.audio.createMediaStreamSource(this.mic).connect(this.analyser);
        this.samples = new Uint8Array(this.analyser.fftSize);
      } catch {
        this.analyser = null;
      }
    }

    const stream = new MediaStream([...this.display.getVideoTracks(), ...(this.mic?.getAudioTracks() ?? [])]);
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 });
    this.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    recorder.onstop = () => this.finish();
    // The browser's own "Stop sharing" button ends the track: treat it as Stop.
    this.display.getVideoTracks()[0]?.addEventListener("ended", () => this.stop());
    recorder.start(1000);
    this.resumedAt = performance.now();
    this.state = "recording";
    return { voice: !!this.mic, micError };
  }

  pause(): void {
    if (this.state !== "recording" || !this.recorder) return;
    this.recorder.pause();
    this.activeMs += performance.now() - this.resumedAt;
    this.state = "paused";
  }

  resume(): void {
    if (this.state !== "paused" || !this.recorder) return;
    this.recorder.resume();
    this.resumedAt = performance.now();
    this.state = "recording";
  }

  /** Ends the recording; `onStop` gets the video. */
  stop(): void {
    if (this.state !== "recording" && this.state !== "paused") return;
    if (this.state === "recording") this.activeMs += performance.now() - this.resumedAt;
    this.state = "idle";
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    else this.finish();
  }

  /** Ends the recording and drops it; `onStop` gets null. */
  discard(): void {
    this.discarded = true;
    this.stop();
  }

  /** Milliseconds recorded so far, pauses left out. */
  elapsed(): number {
    return this.activeMs + (this.state === "recording" ? performance.now() - this.resumedAt : 0);
  }

  /** How loud the microphone is right now, 0 to 1. */
  level(): number {
    if (!this.analyser || !this.samples || this.state !== "recording") return 0;
    this.analyser.getByteTimeDomainData(this.samples as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (const v of this.samples) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }

  private finish() {
    const recorder = this.recorder;
    const voice = !!this.mic;
    const duration = Math.round(this.activeMs / 1000);
    const chunks = this.chunks;
    this.cleanup();
    this.state = "idle";
    if (this.discarded || !chunks.length) return this.onStop(null);
    const type = (recorder?.mimeType || chunks[0].type || "video/webm").split(";")[0];
    const blob = new Blob(chunks, { type });
    this.onStop({ blob, mimeType: type, duration, url: URL.createObjectURL(blob), voice });
  }

  private cleanup() {
    for (const stream of [this.display, this.mic]) stream?.getTracks().forEach((t) => t.stop());
    this.display = this.mic = null;
    this.recorder = null;
    this.chunks = [];
    this.analyser = null;
    this.samples = null;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
  }
}
