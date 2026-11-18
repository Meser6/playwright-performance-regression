// Bottom-k sampling with a bounded heap on typed arrays (08-REQ-12, 08-REQ-28, 08-REQ-29).

/** Value at i of a typed array; the index is always in range. */
function at(array: Float64Array | Int32Array, i: number): number {
  return array[i] ?? 0;
}

/** Code unit order, never localeCompare (08-REQ-12). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const INITIAL_CAPACITY = 16;

/**
 * Keeps the `capacity` samples with the smallest (priority, sampleId); a priority tie is broken
 * by sampleId in UTF-16 code unit order (08-REQ-12). Which samples are kept depends only on the
 * set of added samples, never on their order (08-REQ-13).
 *
 * A max-heap whose root is the largest kept sample, so adding is O(log k) (08-REQ-28). Per kept
 * sample it stores 24 bytes in typed arrays (08-REQ-29): the priority, the duration and TTFB in
 * whole tenths of a millisecond (TTFB −1 when unknown) and the sample identity as an index of
 * the test result plus the ordinal. The sampleId text is rebuilt with `idOf` only on a tie.
 */
export class BottomK {
  readonly capacity: number;
  size = 0;
  private readonly idOf: (resultIndex: number, ordinal: number) => string;
  private priority: Float64Array;
  private duration: Int32Array;
  private ttfb: Int32Array;
  private result: Int32Array;
  private ordinal: Int32Array;

  constructor(capacity: number, idOf: (resultIndex: number, ordinal: number) => string) {
    this.capacity = capacity;
    this.idOf = idOf;
    const initial = Math.min(capacity, INITIAL_CAPACITY);
    this.priority = new Float64Array(initial);
    this.duration = new Int32Array(initial);
    this.ttfb = new Int32Array(initial);
    this.result = new Int32Array(initial);
    this.ordinal = new Int32Array(initial);
  }

  /** Adds a sample: priority from hash53, duration and TTFB in tenths of a ms (TTFB −1: none). */
  add(
    priority: number,
    duration: number,
    ttfb: number,
    resultIndex: number,
    ordinal: number,
  ): void {
    if (this.size < this.capacity) {
      if (this.size === this.priority.length) this.grow();
      this.set(this.size, priority, duration, ttfb, resultIndex, ordinal);
      this.size += 1;
      this.siftUp(this.size - 1);
      return;
    }
    if (this.capacity === 0) return;
    // Full: replace the root only when the new sample is smaller than the largest kept one.
    if (this.compareWith(priority, resultIndex, ordinal, 0) >= 0) return;
    this.set(0, priority, duration, ttfb, resultIndex, ordinal);
    this.siftDown(0);
  }

  /** Kept durations in tenths of a ms, ascending. */
  durations(): number[] {
    return Array.from(this.duration.subarray(0, this.size)).sort((a, b) => a - b);
  }

  /** Known TTFB values of the kept samples in tenths of a ms, ascending. */
  ttfbs(): number[] {
    return Array.from(this.ttfb.subarray(0, this.size))
      .filter((t) => t >= 0)
      .sort((a, b) => a - b);
  }

  private grow(): void {
    const size = Math.min(this.capacity, this.priority.length * 2);
    const copy = <T extends Float64Array | Int32Array>(from: T, to: T): T => {
      to.set(from);
      return to;
    };
    this.priority = copy(this.priority, new Float64Array(size));
    this.duration = copy(this.duration, new Int32Array(size));
    this.ttfb = copy(this.ttfb, new Int32Array(size));
    this.result = copy(this.result, new Int32Array(size));
    this.ordinal = copy(this.ordinal, new Int32Array(size));
  }

  private set(
    i: number,
    priority: number,
    duration: number,
    ttfb: number,
    resultIndex: number,
    ordinal: number,
  ): void {
    this.priority[i] = priority;
    this.duration[i] = duration;
    this.ttfb[i] = ttfb;
    this.result[i] = resultIndex;
    this.ordinal[i] = ordinal;
  }

  /** Order of (priority, resultIndex, ordinal) relative to the kept sample j. */
  private compareWith(priority: number, resultIndex: number, ordinal: number, j: number): number {
    const diff = priority - at(this.priority, j);
    if (diff !== 0) return diff;
    return compareText(
      this.idOf(resultIndex, ordinal),
      this.idOf(at(this.result, j), at(this.ordinal, j)),
    );
  }

  private compare(i: number, j: number): number {
    return this.compareWith(at(this.priority, i), at(this.result, i), at(this.ordinal, i), j);
  }

  private swap(i: number, j: number): void {
    for (const array of [this.priority, this.duration, this.ttfb, this.result, this.ordinal]) {
      const value = at(array, i);
      array[i] = at(array, j);
      array[j] = value;
    }
  }

  private siftUp(start: number): void {
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (this.compare(i, parent) <= 0) return;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(start: number): void {
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= this.size) return;
      const right = left + 1;
      const larger = right < this.size && this.compare(right, left) > 0 ? right : left;
      if (this.compare(larger, i) <= 0) return;
      this.swap(i, larger);
      i = larger;
    }
  }
}
