import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SilentAudioLoopService } from '../SoundNotificationService';

describe('SilentAudioLoopService', () => {
  beforeEach(() => {
    const mockAudioInstance = {
      paused: true,
      ended: false,
      currentTime: 0,
      loop: false,
      volume: 1.0,
      muted: false,
      play: vi.fn().mockImplementation(function (this: any) {
        this.paused = false;
        return Promise.resolve();
      }),
      pause: vi.fn().mockImplementation(function (this: any) {
        this.paused = true;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    function MockAudio(this: any) {
      return mockAudioInstance;
    }

    if (typeof (globalThis as any).window === 'undefined') {
      (globalThis as any).window = {};
    }
    (globalThis as any).window.Audio = MockAudio;
    (globalThis as any).Audio = MockAudio;

    const mockMediaSession = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn(),
    };

    try {
      (globalThis.navigator as any).mediaSession = mockMediaSession;
    } catch {
      Object.defineProperty(globalThis, 'navigator', {
        value: { mediaSession: mockMediaSession },
        configurable: true,
        writable: true,
      });
    }

    function MockMediaMetadata(this: any, init: any) {
      Object.assign(this, init);
    }
    (globalThis as any).MediaMetadata = MockMediaMetadata;

    SilentAudioLoopService.stop();
  });

  afterEach(() => {
    SilentAudioLoopService.stop();
    vi.restoreAllMocks();
  });

  it('manages active and manuallyPaused state across start, pause, toggle and stop', async () => {
    expect(SilentAudioLoopService.isPlaying()).toBe(false);
    expect(SilentAudioLoopService.isManuallyPaused()).toBe(false);

    // Call start
    const started = await SilentAudioLoopService.start();
    expect(started).toBe(true);
    expect(SilentAudioLoopService.isPlaying()).toBe(true);
    expect(SilentAudioLoopService.isManuallyPaused()).toBe(false);

    // Call pause
    SilentAudioLoopService.pause();
    expect(SilentAudioLoopService.isPlaying()).toBe(false);
    expect(SilentAudioLoopService.isManuallyPaused()).toBe(true);

    // autoStartIfAllowed should NOT start when manually paused
    const autoStarted = await SilentAudioLoopService.autoStartIfAllowed();
    expect(autoStarted).toBe(false);

    // Toggle should resume when paused
    const toggled = await SilentAudioLoopService.toggle();
    expect(toggled).toBe(true);
    expect(SilentAudioLoopService.isPlaying()).toBe(true);
    expect(SilentAudioLoopService.isManuallyPaused()).toBe(false);

    // Toggle again should pause
    const toggledAgain = await SilentAudioLoopService.toggle();
    expect(toggledAgain).toBe(false);
    expect(SilentAudioLoopService.isPlaying()).toBe(false);
    expect(SilentAudioLoopService.isManuallyPaused()).toBe(true);

    // Stop should reset manuallyPaused and active state
    SilentAudioLoopService.stop();
    expect(SilentAudioLoopService.isPlaying()).toBe(false);
    expect(SilentAudioLoopService.isManuallyPaused()).toBe(false);
  });

  it('notifies subscribers on status changes', async () => {
    const listener = vi.fn();
    const unsubscribe = SilentAudioLoopService.subscribe(listener);

    // Initial notification on subscribe
    expect(listener).toHaveBeenCalledWith(false);

    await SilentAudioLoopService.start();
    expect(listener).toHaveBeenCalledWith(true);

    SilentAudioLoopService.pause();
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it('configures MediaSession playbackState and action handlers', async () => {
    const mockMediaSession = (globalThis as any).navigator?.mediaSession;

    await SilentAudioLoopService.start();

    expect(mockMediaSession.playbackState).toBe('playing');
    expect(mockMediaSession.metadata.title).toContain('탭 절전 방지');
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith('play', expect.any(Function));
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith('pause', expect.any(Function));

    SilentAudioLoopService.pause();
    expect(mockMediaSession.playbackState).toBe('paused');

    SilentAudioLoopService.stop();
    expect(mockMediaSession.playbackState).toBe('none');
  });

  it('safely handles concurrent start calls without duplicating play requests', async () => {
    const [res1, res2] = await Promise.all([
      SilentAudioLoopService.start(),
      SilentAudioLoopService.start(),
    ]);

    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(SilentAudioLoopService.isPlaying()).toBe(true);
  });

  it('safely handles pause while play promise is in-flight without unhandled AbortError', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // play 호출 시작
    const startPromise = SilentAudioLoopService.start();
    // 즉시 pause 호출 (play 완료 전)
    SilentAudioLoopService.pause();

    const startResult = await startPromise;
    expect(startResult).toBe(false);
    expect(SilentAudioLoopService.isPlaying()).toBe(false);
    expect(SilentAudioLoopService.isManuallyPaused()).toBe(true);

    // AbortError로 인한 경고 출력이 없어야 함
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('무음 사운드 재생 실패'),
      expect.anything()
    );

    consoleWarnSpy.mockRestore();
  });
});
