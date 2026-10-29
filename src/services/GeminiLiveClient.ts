// src/services/GeminiLiveClient.ts
// Live API 클라이언트 유틸리티 (서버의 WebSocket 프록시 /api/live 연결)

export interface LiveSessionOptions {
  onAudioChunk?: (base64Audio: string) => void;
  onText?: (text: string) => void;
  onInterrupted?: () => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

export interface LiveSession {
  sendAudio: (base64Pcm: string, mimeType?: string) => void;
  sendText: (text: string) => void;
  sendVideo: (base64Image: string, mimeType?: string) => void;
  startMic: () => Promise<void>;
  stop: () => void;
}

export function connectLiveSession(options: LiveSessionOptions = {}): LiveSession {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/live`;
  const ws = new WebSocket(wsUrl);

  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.audio && options.onAudioChunk) {
        options.onAudioChunk(msg.audio);
      }
      if (msg.interrupted && options.onInterrupted) {
        options.onInterrupted();
      }
      if (msg.text && options.onText) {
        options.onText(msg.text);
      }
      if (msg.error && options.onError) {
        options.onError(msg.error);
      }
      if (msg.closed && options.onClose) {
        options.onClose();
      }
    } catch (err: any) {
      console.error('[GeminiLiveClient] Failed to parse message:', err);
    }
  };

  ws.onerror = (err) => {
    console.error('[GeminiLiveClient] WebSocket error:', err);
    options.onError?.('WebSocket connection error');
  };

  ws.onclose = () => {
    options.onClose?.();
  };

  const sendAudio = (base64Pcm: string, mimeType = 'audio/pcm;rate=16000') => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ audio: base64Pcm, mimeType }));
    }
  };

  const sendText = (text: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ text }));
    }
  };

  const sendVideo = (base64Image: string, mimeType = 'image/jpeg') => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ video: base64Image, mimeType }));
    }
  };

  const startMic = async () => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      const source = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Float32 to 16-bit PCM LE
        const buffer = new ArrayBuffer(inputData.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        sendAudio(btoa(binary));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err: any) {
      console.error('[GeminiLiveClient] Failed to start microphone:', err);
      options.onError?.(err?.message || 'Microphone access failed');
    }
  };

  const stop = () => {
    if (processor) {
      processor.disconnect();
      processor = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };

  return {
    sendAudio,
    sendText,
    sendVideo,
    startMic,
    stop,
  };
}
