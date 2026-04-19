import { useEffect, useRef } from "react";

// Simple wake-word capture: opens a 16kHz mono AudioContext, feeds frames
// through an AudioWorklet that posts Float32 chunks of ~100ms each. Each chunk
// is forwarded to the main process over IPC, where WakeWordManager runs the
// sherpa-onnx keyword spotter. Suppressed while the user is actively recording
// (so the user's own dictation doesn't trip the wake word).

const WAKE_WORD_CHUNK_SAMPLES = 1600; // 100ms @ 16kHz

const getWakeWordWorkletBlobUrl = (() => {
  let blobUrl: string | null = null;
  return () => {
    if (blobUrl) return blobUrl;
    const code = `
const CHUNK = ${WAKE_WORD_CHUNK_SAMPLES};
class WakeWordProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(CHUNK);
    this._offset = 0;
    this._active = true;
    this.port.onmessage = (event) => {
      if (event.data && typeof event.data === "object") {
        if (event.data.type === "setActive") {
          this._active = !!event.data.active;
          if (!this._active) this._offset = 0;
        }
      }
    };
  }
  process(inputs) {
    if (!this._active) return true;
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this._buffer[this._offset++] = input[i];
      if (this._offset >= CHUNK) {
        const out = this._buffer;
        this._buffer = new Float32Array(CHUNK);
        this._offset = 0;
        this.port.postMessage(out.buffer, [out.buffer]);
      }
    }
    return true;
  }
}
registerProcessor("wake-word-processor", WakeWordProcessor);
`;
    blobUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    return blobUrl;
  };
})();

interface WakeWordStatus {
  enabled: boolean;
  modelDownloaded: boolean;
  running: boolean;
  presetId?: string;
  threshold?: number;
}

export function useWakeWord({ isUserRecording }: { isUserRecording: boolean }) {
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const runningRef = useRef(false);
  const recordingRef = useRef(false);

  const stop = async () => {
    runningRef.current = false;
    try {
      nodeRef.current?.port?.postMessage({ type: "setActive", active: false });
      nodeRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    try {
      await contextRef.current?.close();
    } catch {
      // ignore
    }
    nodeRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    contextRef.current = null;
  };

  const start = async () => {
    if (runningRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      // Chromium honors sampleRate for AudioContext — internal resampling handles mismatches.
      const ctx = new AudioContext({ sampleRate: 16000 });
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      await ctx.audioWorklet.addModule(getWakeWordWorkletBlobUrl());
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "wake-word-processor");

      node.port.onmessage = (event: MessageEvent) => {
        if (!runningRef.current) return;
        if (recordingRef.current) return;
        const data = event.data;
        if (!(data instanceof ArrayBuffer)) return;
        try {
          window.electronAPI?.wakeWord?.feedAudio(data);
        } catch {
          // ignore
        }
      };

      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(node);
      node.connect(silent);
      silent.connect(ctx.destination);

      contextRef.current = ctx;
      streamRef.current = stream;
      nodeRef.current = node;
      sourceRef.current = source;
      runningRef.current = true;

      // Apply current suppression state
      node.port.postMessage({ type: "setActive", active: !recordingRef.current });
    } catch (err) {
      console.warn("[wake-word] capture failed:", err);
      await stop();
    }
  };

  useEffect(() => {
    recordingRef.current = isUserRecording;
    if (nodeRef.current) {
      nodeRef.current.port.postMessage({ type: "setActive", active: !isUserRecording });
    }
    if (isUserRecording) {
      window.electronAPI?.wakeWord?.setSuppressed?.(true);
    } else {
      window.electronAPI?.wakeWord?.setSuppressed?.(false);
    }
  }, [isUserRecording]);

  useEffect(() => {
    let cancelled = false;

    const apply = async (status: WakeWordStatus) => {
      if (cancelled) return;
      if (status.enabled && status.running) {
        await start();
      } else {
        await stop();
      }
    };

    const init = async () => {
      try {
        const status: WakeWordStatus = await window.electronAPI?.wakeWord?.getStatus?.();
        if (status) await apply(status);
      } catch {
        // ignore
      }
    };

    init();

    const off = window.electronAPI?.wakeWord?.onStatusChange?.((status: WakeWordStatus) => {
      apply(status);
    });

    return () => {
      cancelled = true;
      try {
        off?.();
      } catch {
        // ignore
      }
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
