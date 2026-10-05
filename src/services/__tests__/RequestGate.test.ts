import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RequestGate,
  GATE_CANCELLED_MESSAGE,
  GATE_PRIORITY_MAIN,
  GATE_PRIORITY_SUBCHUNK,
} from '../RequestGate';

describe('RequestGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 통과 순서를 기록하는 헬퍼
  const track = (gate: RequestGate, order: string[], label: string, priority: number, orderKey?: number) =>
    gate.acquire({ priority, orderKey }).then(() => {
      order.push(label);
    });

  it('첫 요청은 바로 통과하고 다음 요청은 RPM 간격만큼 기다린다', async () => {
    const gate = new RequestGate(6); // 10초 간격
    const order: string[] = [];

    track(gate, order, 'a', GATE_PRIORITY_MAIN, 0);
    track(gate, order, 'b', GATE_PRIORITY_MAIN, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(9999);
    expect(order).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(['a', 'b']);
  });

  it('슬롯이 열리는 순간 나중에 들어온 서브청크를 메인 청크보다 먼저 내보낸다', async () => {
    const gate = new RequestGate(6);
    const order: string[] = [];

    track(gate, order, 'main-0', GATE_PRIORITY_MAIN, 0);
    track(gate, order, 'main-1', GATE_PRIORITY_MAIN, 1);
    track(gate, order, 'main-2', GATE_PRIORITY_MAIN, 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['main-0']);

    // main-1, main-2가 줄 서 있는 동안 분할 재시도가 생긴다
    await vi.advanceTimersByTimeAsync(5000);
    track(gate, order, 'sub', GATE_PRIORITY_SUBCHUNK);

    await vi.advanceTimersByTimeAsync(5000);
    expect(order).toEqual(['main-0', 'sub']);

    await vi.advanceTimersByTimeAsync(20000);
    expect(order).toEqual(['main-0', 'sub', 'main-1', 'main-2']);
  });

  it('같은 우선순위에서는 orderKey가 작은 쪽이 먼저 나간다', async () => {
    const gate = new RequestGate(0); // 간격 없음
    const order: string[] = [];
    // 간격이 없으면 들어오는 즉시 나가므로, 게이트를 먼저 막아 두고 비교한다
    const blocked = new RequestGate(6);
    track(blocked, order, 'first', GATE_PRIORITY_MAIN, 0);
    await vi.advanceTimersByTimeAsync(0);
    track(blocked, order, 'key-5', GATE_PRIORITY_MAIN, 5);
    track(blocked, order, 'key-2', GATE_PRIORITY_MAIN, 2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(order).toEqual(['first', 'key-2']);

    // RPM 0이면 대기 없이 모두 통과한다
    const free: string[] = [];
    await Promise.all([track(gate, free, 'x', GATE_PRIORITY_MAIN), track(gate, free, 'y', GATE_PRIORITY_MAIN)]);
    expect(free).toEqual(['x', 'y']);
  });

  it('cancelAll은 대기 중인 요청만 취소하고, 이후 요청은 다시 받는다', async () => {
    const gate = new RequestGate(6);
    const passed = gate.acquire({ priority: GATE_PRIORITY_MAIN, orderKey: 0 });
    const waiting = gate.acquire({ priority: GATE_PRIORITY_MAIN, orderKey: 1 });
    await expect(passed).resolves.toBeUndefined();

    expect(gate.cancelAll('429')).toBe(1);
    await expect(waiting).rejects.toThrow(GATE_CANCELLED_MESSAGE);
    expect(gate.pendingCount).toBe(0);

    // reset 후에는 이전 통과 시각이 지워져 바로 통과한다
    gate.reset();
    await expect(gate.acquire({ priority: GATE_PRIORITY_MAIN })).resolves.toBeUndefined();
  });
});
