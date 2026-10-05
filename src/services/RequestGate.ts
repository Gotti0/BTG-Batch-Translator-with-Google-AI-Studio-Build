// services/RequestGate.ts
// 분당 요청 수(RPM) 한도를 지키면서, 슬롯이 열리는 순간 대기 중인 요청 중 우선순위가 가장 높은 것을 내보내는 게이트.
//
// 이전에는 GeminiClient가 요청마다 "다음 빈 슬롯"을 선점한 뒤 잠들었다. 워커들이 미래 슬롯을 먼저 잡아 두기 때문에
// 콘텐츠 안전 오류로 분할된 서브청크는 이미 줄 선 메인 청크들 뒤로 밀려 몇 분씩 기다려야 했다.
// 게이트는 슬롯을 미리 나눠 주지 않고, 슬롯이 열린 시점에 대기열을 보고 한 건씩 통과시킨다.

/** 우선순위가 가장 높다 (분할 재시도 서브청크) */
export const GATE_PRIORITY_SUBCHUNK = 0;
/** 일반 청크 */
export const GATE_PRIORITY_MAIN = 1;

/** 게이트 대기 중 취소되었음을 나타내는 오류 메시지 */
export const GATE_CANCELLED_MESSAGE = 'REQUEST_GATE_CANCELLED';

export interface GateRequest {
  /** 작을수록 먼저 나간다 */
  priority: number;
  /** 같은 우선순위 안에서의 순서 (작을수록 먼저). 생략하면 들어온 순서 */
  orderKey?: number;
}

interface Waiter {
  priority: number;
  orderKey: number;
  seq: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class RequestGate {
  private intervalMs: number;
  private lastDispatchAt = -Infinity;
  private waiters: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(requestsPerMinute: number, private readonly now: () => number = () => Date.now()) {
    this.intervalMs = requestsPerMinute > 0 ? 60000 / requestsPerMinute : 0;
  }

  setRequestsPerMinute(requestsPerMinute: number): void {
    this.intervalMs = requestsPerMinute > 0 ? 60000 / requestsPerMinute : 0;
    this.clearTimer();
    this.pump();
  }

  /** 대기 중인 요청 수 */
  get pendingCount(): number {
    return this.waiters.length;
  }

  /**
   * 통과 허가를 기다린다. 허가가 나면 바로 API를 호출해야 한다.
   */
  acquire(request: GateRequest): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const seq = this.seq++;
      this.waiters.push({
        priority: request.priority,
        orderKey: request.orderKey ?? seq,
        seq,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  /**
   * 대기 중인 요청을 모두 취소한다. 이미 통과한 요청에는 영향이 없다.
   * @returns 취소된 요청 수
   */
  cancelAll(reason: string = GATE_CANCELLED_MESSAGE): number {
    const cancelled = this.waiters;
    this.waiters = [];
    this.clearTimer();
    const error = new Error(GATE_CANCELLED_MESSAGE);
    (error as Error & { reason?: string }).reason = reason;
    cancelled.forEach((w) => w.reject(error));
    return cancelled.length;
  }

  /** 새 작업을 시작할 때 이전 작업의 마지막 통과 시각을 지운다 */
  reset(): void {
    this.cancelAll();
    this.lastDispatchAt = -Infinity;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private takeHighestPriority(): Waiter | undefined {
    if (this.waiters.length === 0) return undefined;
    let bestIndex = 0;
    for (let i = 1; i < this.waiters.length; i++) {
      const a = this.waiters[i];
      const b = this.waiters[bestIndex];
      if (
        a.priority < b.priority ||
        (a.priority === b.priority && (a.orderKey < b.orderKey || (a.orderKey === b.orderKey && a.seq < b.seq)))
      ) {
        bestIndex = i;
      }
    }
    return this.waiters.splice(bestIndex, 1)[0];
  }

  private pump(): void {
    if (this.timer !== null) return;

    while (this.waiters.length > 0) {
      const now = this.now();
      const nextSlot = this.lastDispatchAt + this.intervalMs;
      if (this.intervalMs > 0 && nextSlot > now) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, nextSlot - now);
        return;
      }

      const waiter = this.takeHighestPriority();
      if (!waiter) return;
      // 타이머가 늦게 깨어나도 실제 통과 간격이 한도보다 좁아지지 않도록 실제 시각을 기록한다
      this.lastDispatchAt = now;
      waiter.resolve();
    }
  }
}
