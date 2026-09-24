import { useState, useRef, useCallback } from 'react';
import { encodeWAV } from '../utils/audioUtils';

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  audioVolume: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
}

/**
 * Microphone recorder producing 16kHz mono PCM WAV — the native format for
 * whisper.cpp and accepted by Groq/OpenAI APIs. Raw float samples are tapped
 * with a ScriptProcessorNode (auto resampled to the AudioContext rate) and
 * downmixed to mono at 16kHz on stop.
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0);

  const isRecordingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunkRef = useRef<Float32Array[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const updateVolume = useCallback(() => {
    if (!analyserRef.current || !isRecordingRef.current) {
      setAudioVolume(0);
      return;
    }

    const dataArray = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(dataArray);

    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sumSquares += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);

    // Strict noise gate: room silence/hiss is < 0.015; human voice starts > 0.025
    const NOISE_GATE = 0.016;
    const normalized = rms < NOISE_GATE ? 0 : Math.min(1, (rms - NOISE_GATE) * 4.5);
    setAudioVolume(normalized);

    animFrameRef.current = requestAnimationFrame(updateVolume);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // Query user's selected microphone from settings if configured
      let preferredDeviceId: string | undefined;
      try {
        const s = await window.speakyAPI?.getSettings?.();
        if (s?.selectedMicId && s.selectedMicId !== 'default') {
          preferredDeviceId = s.selectedMicId;
        }
      } catch {}

      // Try high-quality constraints first; gracefully fallback to basic audio on older sound cards
      let stream: MediaStream;
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };
      if (preferredDeviceId) {
        audioConstraints.deviceId = { exact: preferredDeviceId };
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (errConstraints) {
        console.warn('[Audio] Advanced constraints failed on this audio device, falling back to standard audio:', errConstraints);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : true
        });
      }
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // 85Hz High-pass filter removes sub-bass rumble, desk thumps, 50/60Hz AC hum
      const highpass = audioCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 85;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      // PCM tap: collect raw mono float samples while recording
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      chunkRef.current = [];
      processor.onaudioprocess = (e) => {
        if (!isRecordingRef.current) return;
        chunkRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      source.connect(highpass);
      highpass.connect(analyser);
      highpass.connect(processor);
      // ScriptProcessor requires a destination connection to pump events;
      // use a zero-gain node so nothing is played back aloud.
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      isRecordingRef.current = true;
      setIsRecording(true);

      animFrameRef.current = requestAnimationFrame(updateVolume);
    } catch (err) {
      cleanupGraph();
      console.error('[Audio] Failed to access microphone:', err);
      throw err;
    }
  }, [updateVolume]);

  const cleanupGraph = () => {
    try { processorRef.current?.disconnect(); } catch {}
    try { sourceRef.current?.disconnect(); } catch {}
    processorRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      isRecordingRef.current = false;
      setIsRecording(false);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      setAudioVolume(0);

      const audioCtx = audioContextRef.current;
      const chunks = chunkRef.current;
      chunkRef.current = [];

      // Small delay lets the last onaudioprocess buffer land in chunkRef
      setTimeout(() => {
        cleanupGraph();

        const finalChunks = chunks.length > 0 ? chunks : chunkRef.current;
        const totalLen = finalChunks.reduce((acc, c) => acc + c.length, 0);

        // Reject if genuinely empty (< ~150ms of audio)
        if (!audioCtx || totalLen < audioCtx.sampleRate * 0.15) {
          resolve(null);
          return;
        }

        // Concatenate + downmix/quality-safe resample to 16kHz mono
        const merged = new Float32Array(totalLen);
        let offset = 0;
        for (const c of finalChunks) {
          merged.set(c, offset);
          offset += c.length;
        }

        try {
          const samples16k = resampleLinear(merged, audioCtx.sampleRate, 16000);
          resolve(encodeWAV(samples16k, 16000));
        } catch (err) {
          console.error('[Audio] Failed to encode WAV:', err);
          resolve(null);
        }
      }, 120);
    });
  }, []);

  return {
    isRecording,
    audioVolume,
    startRecording,
    stopRecording
  };
}

/** Simple linear-interpolation resampler, fine for speech (16kHz target). */
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] || 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
