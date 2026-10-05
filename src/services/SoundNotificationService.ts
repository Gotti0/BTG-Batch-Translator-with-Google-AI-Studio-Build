// services/SoundNotificationService.ts
// 작업 완료 차임과 백그라운드 탭 절전 방지용 무음 오디오 루프
// 브라우저는 백그라운드 탭의 타이머·네트워크를 늦추는데, 오디오가 재생 중인 탭은 예외로 둔다.
// 긴 번역 중 탭을 내려 두어도 RPM 대기 타이머가 밀리지 않도록 무음 오디오를 재생한다.

/**
 * 장시간 작업(번역)이 시작될 때 호출: 설정이 켜져 있으면 무음 루프를 시작한다
 */
export function notifyWorkStarted(options: { enableSilentAudioLoop: boolean }): void {
  if (options.enableSilentAudioLoop) {
    SilentAudioLoopService.autoStartIfAllowed();
  }
}

/**
 * 장시간 작업이 끝났을 때 호출: 무음 루프를 멈추고, 정상 완료면 알림음을 울린다
 */
export function notifyWorkFinished(options: { enableSoundNotification: boolean; completed: boolean }): void {
  SilentAudioLoopService.stop();
  if (options.completed && options.enableSoundNotification) {
    SoundNotificationService.playChime();
  }
}

/**
 * 작업 완료 시 맑은 차임벨 소리("띵띵") 재생 서비스 (Web Audio API)
 */
export class SoundNotificationService {
  private static audioCtx: AudioContext | null = null;

  private static getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * 맑은 차임벨 소리 ("띵띵") 연주
   */
  static playChime() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // 첫 번째 띵 (High C6 / 1046.5 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1046.5, now);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.8);

      // 두 번째 띵 (Higher G6 / 1567.98 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1567.98, now + 0.22);
      gain2.gain.setValueAtTime(0.35, now + 0.22);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.22);
      osc2.stop(now + 1.2);
    } catch (e) {
      console.warn('차임벨 사운드 재생 실패:', e);
    }
  }
}

/**
 * 탭 비활성화 방지용 무음 사운드 재생 서비스
 * - 브라우저가 백그라운드 탭의 타이머나 네트워크 요청을 스로틀링/절전하지 않도록
 *   15초 무음 WAV 오디오를 연속 루프로 재생하여 활성 미디어 세션을 유지합니다.
 * - Android Notification Shade / 잠금화면 미디어 컨트롤러(MediaSession API)를 활성화하여
 *   OS의 백그라운드 프로세스 절전/메모리 킬(LMK)을 방지하고 알림 바에서 직접 재생/일시정지를 제어할 수 있습니다.
 * - 번역 작업 도중 사용자가 임의로 끄거나 켤 수 있으며, 블루투스 헤드셋 분리 등으로 중지되어도 원클릭으로 재개할 수 있습니다.
 */
export class SilentAudioLoopService {
  private static audio: HTMLAudioElement | null = null;
  private static active: boolean = false;
  private static manuallyPaused: boolean = false;
  private static shouldPlay: boolean = false;
  private static playPromise: Promise<boolean> | null = null;
  private static testTimer: any = null;
  private static listeners: Set<(playing: boolean) => void> = new Set();
  private static silentWavUrl: string | null = null;
  private static cachedArtworkDataUri: string | null = null;

  // 유효한 Lavf/LAME 인코딩 무음 MP3 오디오 데이터 (WAV Blob 실패 시 fallback용)
  private static readonly SILENT_MP3_URI = 
    "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU3LjcxLjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAEAAABVgANTU1NTU1Q0NDQ0NDUFBQUFBQXl5eXl5ea2tra2tra3l5eXl5eYaGhoaGhpSUlJSUlKGhoaGhoaGvr6+vr6+8vLy8vLzKysrKysrX19fX19fX5eXl5eXl8vLy8vLy////////AAAAAExhdmM1Ny44OQAAAAAAAAAAAAAAACQCgAAAAAAAAAVY82AhbwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAALACwAAP/AADwQKVE9YWDGPkQWpT66yk4+zIiYPoTUaT3tnU487uNhOvEmQDaCm1Yz1c6DPjbs6zdZVBk0pdGpMzxF/+MYxA8L0DU0AP+0ANkwmYaAMkOKDDjmYoMtwNMyDxMzDHE/MEsLow9AtDnBlQgDhTx+Eye0GgMHoCyDC8gUswJcMVMABBGj/+MYxBoK4DVpQP8iAtVmDk7LPgi8wvDzI4/MWAwK1T7rxOQwtsItMMQBazAowc4wZMC5MF4AeQAGDpruNuMEzyfjLBJhACU+/+MYxCkJ4DVcAP8MAO9J9THVg6oxRMGNMIqCCTAEwzwwBkINOPAs/iwjgBnMepYyId0PhWo+80PXMVsBFzD/AiwwfcKGMEJB/+MYxDwKKDVkAP8eAF8wMwIxMlpU/OaDPLpNKkEw4dRoBh6qP2FC8jCJQFcweQIPMHOBtTBoAVcwOoCNMYDI0u0Dd8ANTIsy/+MYxE4KUDVsAP8eAFBVpgVVPjdGeTEWQr0wdcDtMCeBgDBkgRgwFYB7Pv/zqx0yQQMCCgKNgonHKj6RRVkxM0GwML0AhDAN/+MYxF8KCDVwAP8MAIHZMDDA3DArAQo3K+TF5WOBDQw0lgcKQUJxhT5sxRcwQQI+EIPWMA7AVBoTABgTgzfBN+ajn3c0lZMe/+MYxHEJyDV0AP7MAA4eEwsqP/PDmzC/gNcwXUGaMBVBIwMEsmB6gaxhVuGkpoqMZMQjooTBwM0+S8FTMC0BcjBTgPwwOQDm/+MYxIQKKDV4AP8WADAzAKQwI4CGPhWOEwCFAiBAYQnQMT+uwXUeGzjBWQVkwTcENMBzA2zAGgFEJfSPkPSZzPXgqFy2h0xB/+MYxJYJCDV8AP7WAE0+7kK7MQrATDAvQRIwOADKMBuA9TAYQNM3AiOSPjGxowgHMKFGcBNMQU1FMy45OS41VVU/31eYM4sK/+MYxKwJaDV8AP7SAI4y1Yq0MmOIADGwBZwwlgIJMztCM0qU5TQPG/MSkn8yEROzCdAxECVMQU1FMy45OS41VTe7Ohk+Pqcx/+MYxMEJMDWAAP6MADVLDFUx+4J6Mq7NsjN2zXo8V5fjVJCXNOhwM0vTCDAxFpMYYQU+RlVMQU1FMy45OS41VVVVVVVVVVVV/+MYxNcJADWAAP7EAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxOsJwDWEAP7SAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxPMLoDV8AP+eAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxPQL0DVcAP+0AFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

  /**
   * 브라우저와 안드로이드 OS가 정상적인 지속 오디오 미디어로 인식할 수 있도록
   * 15초 길이의 무음 WAV Blob URL을 동적으로 생성합니다.
   * (짧은 단발성 사운드 이펙트로 분류되어 알림 바 컨트롤러가 누락되는 현상 방지)
   */
  private static getSilentWavUrl(): string {
    if (this.silentWavUrl) return this.silentWavUrl;
    try {
      if (typeof window === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
        return this.SILENT_MP3_URI;
      }
      const durationSeconds = 15;
      const sampleRate = 8000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const blockAlign = (numChannels * bitsPerSample) / 8;
      const byteRate = sampleRate * blockAlign;
      const numSamples = sampleRate * durationSeconds;
      const dataSize = numSamples * blockAlign;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);

      // RIFF identifier
      view.setUint32(0, 0x52494646, false); // 'RIFF'
      view.setUint32(4, 36 + dataSize, true);
      view.setUint32(8, 0x57415645, false); // 'WAVE'

      // fmt subchunk
      view.setUint32(12, 0x666d7420, false); // 'fmt '
      view.setUint32(16, 16, true);          // 16 for PCM
      view.setUint16(20, 1, true);           // PCM format
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);

      // data subchunk
      view.setUint32(36, 0x64617461, false); // 'data'
      view.setUint32(40, dataSize, true);
      // PCM 16-bit silence is all 0s

      const blob = new Blob([buffer], { type: 'audio/wav' });
      this.silentWavUrl = URL.createObjectURL(blob);
      return this.silentWavUrl;
    } catch (e) {
      console.warn('WAV Blob URL 생성 실패, 기본 MP3 데이터 사용:', e);
      return this.SILENT_MP3_URI;
    }
  }

  /**
   * 안드로이드 알림 바 / 잠금 화면 미디어 카드용 512x512 PNG 아트워크 생성
   */
  private static getArtworkDataUri(): string {
    if (this.cachedArtworkDataUri) return this.cachedArtworkDataUri;
    try {
      if (typeof document === 'undefined') return '';
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      // 블루 그라데이션 배경
      const grad = ctx.createLinearGradient(0, 0, 512, 512);
      grad.addColorStop(0, '#1d4ed8');
      grad.addColorStop(1, '#2563eb');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);

      // 은은한 원형 배경
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.arc(256, 256, 190, 0, Math.PI * 2);
      ctx.fill();

      // 메인 타이틀
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 120px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BTG', 256, 210);

      // 하단 라벨
      ctx.font = 'bold 36px sans-serif';
      ctx.fillStyle = '#93c5fd';
      ctx.fillText('탭 절전 방지 🔊', 256, 320);

      this.cachedArtworkDataUri = canvas.toDataURL('image/png');
      return this.cachedArtworkDataUri;
    } catch (e) {
      return '';
    }
  }

  /**
   * Android Notification Shade 및 잠금 화면의 MediaSession 컨트롤러 상태 업데이트
   */
  private static updateMediaSession(state: 'playing' | 'paused' | 'none') {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    try {
      if (state === 'none') {
        navigator.mediaSession.playbackState = 'none';
        return;
      }

      const artworkUri = this.getArtworkDataUri();
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'BTG 번역 진행 중 (탭 절전 방지)',
        artist: 'BTG - Batch Translator',
        album: '백그라운드 미디어 세션 유지',
        artwork: artworkUri
          ? [{ src: artworkUri, sizes: '512x512', type: 'image/png' }]
          : [],
      });

      navigator.mediaSession.playbackState = state;

      // 안드로이드 알림 바 미디어 컨트롤러 (재생 / 일시정지) 상호작용 바인딩
      navigator.mediaSession.setActionHandler('play', () => {
        SilentAudioLoopService.start();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        SilentAudioLoopService.pause();
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        SilentAudioLoopService.pause();
      });
    } catch (e) {
      console.warn('MediaSession 제어 설정 오류:', e);
    }
  }

  private static notifyListeners() {
    const isPlayingNow = this.isPlaying();
    this.listeners.forEach((listener) => {
      try {
        listener(isPlayingNow);
      } catch (e) {
        console.error('Audio loop listener error:', e);
      }
    });
  }

  /**
   * 재생 상태 변경 구독
   */
  static subscribe(listener: (isPlaying: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isPlaying());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 현재 실제 재생 중 여부
   */
  static isPlaying(): boolean {
    return !!(this.audio && !this.audio.paused && !this.audio.ended && this.active);
  }

  /**
   * 사용자가 의도적으로 일시 중지(무음 끄기)했는지 여부
   */
  static isManuallyPaused(): boolean {
    return this.manuallyPaused;
  }

  private static ensureAudioElement(): HTMLAudioElement {
    if (!this.audio) {
      const audioSource = this.getSilentWavUrl();
      this.audio = new Audio(audioSource);
      this.audio.loop = true;
      // 볼륨이 0이면 브라우저가 스피커 아이콘을 띄우지 않거나 미디어 세션을 절전 처리할 수 있으므로
      // 무음 음원 자체를 1.0 볼륨으로 정상 출력합니다.
      this.audio.volume = 1.0;
      this.audio.muted = false;

      this.audio.addEventListener('play', () => {
        this.active = true;
        this.updateMediaSession('playing');
        this.notifyListeners();
      });
      this.audio.addEventListener('playing', () => {
        this.active = true;
        this.updateMediaSession('playing');
        this.notifyListeners();
      });
      this.audio.addEventListener('pause', () => {
        this.active = false;
        this.updateMediaSession('paused');
        this.notifyListeners();
      });
      this.audio.addEventListener('ended', () => {
        this.active = false;
        this.updateMediaSession('paused');
        this.notifyListeners();
      });
      this.audio.addEventListener('error', (e) => {
        console.warn('무음 오디오 재생 에러:', e);
        this.active = false;
        this.updateMediaSession('none');
        this.notifyListeners();
      });
    }
    return this.audio;
  }

  // playPromise 락과 shouldPlay 플래그로 멱등성을 보장하며 무음 루프를 시작/재개합니다. HOW/WHAT
  // USER 요구: 재생 대기 중 pause/중복 호출 시 발생하는 AbortError 오류 방지. WHY
  static async start(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    this.manuallyPaused = false;
    this.shouldPlay = true;

    if (this.testTimer) {
      clearTimeout(this.testTimer);
      this.testTimer = null;
    }

    // 이미 정상 재생 중이면 추가 탐색 없이 즉시 성공 반환
    if (this.isPlaying()) {
      return true;
    }

    // 이미 play() 요청이 진행 중이면 해당 Promise를 공유하여 중복 호출 차단
    if (this.playPromise) {
      return await this.playPromise;
    }

    const audio = this.ensureAudioElement();

    this.playPromise = (async () => {
      try {
        if (audio.paused) {
          audio.currentTime = 0;
          await audio.play();
        }

        // play() 대기 중 사용자가 pause() 또는 stop()을 요청한 경우 즉시 pause 처리
        if (!this.shouldPlay || this.manuallyPaused) {
          try {
            audio.pause();
          } catch {
            // ignore
          }
          return false;
        }

        this.active = true;
        this.updateMediaSession('playing');
        this.notifyListeners();
        console.log('🔊 [BTG] 탭 비활성화 방지용 무음 사운드 루프가 시작되었습니다.');
        return true;
      } catch (e: any) {
        // pause() 호출 또는 탐색 인터럽트로 인한 AbortError는 정상적인 취소 흐름이므로 경고를 억제합니다.
        if (e?.name === 'AbortError') {
          return false;
        }
        console.warn('⚠️ 무음 사운드 재생 실패 (사용자 제스처 필요 또는 브라우저 정책 차단):', e);
        this.active = false;
        this.updateMediaSession('paused');
        this.notifyListeners();
        return false;
      } finally {
        this.playPromise = null;
      }
    })();

    return await this.playPromise;
  }

  // 진행 중인 playPromise가 완료된 후 안전하게 pause를 수행하도록 조율합니다. HOW/WHAT
  // USER 요구: 비동기 play 도중 즉시 pause 호출 시 브라우저가 강제 거부하는 현상 방지. WHY
  static pause(): void {
    this.manuallyPaused = true;
    this.shouldPlay = false;
    if (this.testTimer) {
      clearTimeout(this.testTimer);
      this.testTimer = null;
    }

    this.active = false;
    this.updateMediaSession('paused');
    this.notifyListeners();

    const executePause = () => {
      if (this.audio) {
        try {
          this.audio.pause();
        } catch {
          // ignore
        }
      }
    };

    if (this.playPromise) {
      this.playPromise.then(executePause).catch(executePause);
    } else {
      executePause();
    }

    console.log('🔇 [BTG] 탭 비활성화 방지용 무음 사운드가 일시 중지되었습니다.');
  }

  /**
   * 무음 루프 토글 (재생 중이면 일시 중지, 중지 상태면 재생 시작)
   */
  static async toggle(): Promise<boolean> {
    if (this.isPlaying()) {
      this.pause();
      return false;
    } else {
      return await this.start();
    }
  }

  /**
   * 작업 시작 시 자동 시작 시도 (사용자가 수동으로 끈 상태가 아닐 때만 시작)
   */
  static async autoStartIfAllowed(): Promise<boolean> {
    if (this.manuallyPaused) {
      return false;
    }
    return await this.start();
  }

  // 미디어 세션을 해제하고 진행 중인 재생 완료 후 안전하게 pause 및 0초 초기화를 수행합니다. HOW/WHAT
  // USER 요구: 번역/용어집 작업 종료 시 AbortError 충돌 없이 무음 세션을 안전하게 정리. WHY
  static stop(): void {
    this.manuallyPaused = false;
    this.shouldPlay = false;
    if (this.testTimer) {
      clearTimeout(this.testTimer);
      this.testTimer = null;
    }

    this.active = false;
    this.updateMediaSession('none');
    this.notifyListeners();

    const executeStop = () => {
      if (this.audio) {
        try {
          this.audio.pause();
          this.audio.currentTime = 0;
        } catch {
          // ignore
        }
      }
    };

    if (this.playPromise) {
      this.playPromise.then(executeStop).catch(executeStop);
    } else {
      executeStop();
    }

    console.log('🔇 [BTG] 탭 비활성화 방지용 무음 사운드 세션이 종료되었습니다.');
  }

  /**
   * 브라우저 탭에 스피커 아이콘(🔊)이 뜨는지 확인하기 위한 테스트 재생
   * @param durationMs 테스트 재생 지속 시간 (기본값: 3000ms)
   */
  static async testPlay(durationMs: number = 3000): Promise<boolean> {
    const started = await this.start();
    if (!started) return false;

    if (this.testTimer) {
      clearTimeout(this.testTimer);
    }

    this.testTimer = setTimeout(() => {
      this.stop();
      this.testTimer = null;
    }, durationMs);

    return true;
  }
}
