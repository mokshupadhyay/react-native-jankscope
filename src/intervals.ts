/**
 * Sorted, merged time intervals with prefix sums, so the covered length inside
 * any window is two binary searches.
 */
export class IntervalSet {
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];
  /** cumulative[i]: covered length of intervals 0..i-1. */
  private readonly cumulative: number[] = [0];

  /** `pairs` is a flat `[start, end, start, end, ...]` list in any order. */
  constructor(pairs: ArrayLike<number>) {
    const list: Array<[number, number]> = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const start = pairs[i];
      const end = pairs[i + 1];
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) list.push([start, end]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [start, end] of list) {
      const last = this.ends.length - 1;
      if (last >= 0 && start <= this.ends[last]) {
        if (end > this.ends[last]) {
          this.cumulative[last + 1] += end - this.ends[last];
          this.ends[last] = end;
        }
      } else {
        this.starts.push(start);
        this.ends.push(end);
        this.cumulative.push(this.cumulative[this.cumulative.length - 1] + (end - start));
      }
    }
  }

  get size(): number {
    return this.starts.length;
  }

  /** Each merged interval, shortened by `trim` at its start; intervals shorter than `trim` vanish. */
  trimStarts(trim: number): IntervalSet {
    const pairs: number[] = [];
    for (let i = 0; i < this.starts.length; i++) {
      if (this.ends[i] - this.starts[i] > trim) pairs.push(this.starts[i] + trim, this.ends[i]);
    }
    return new IntervalSet(pairs);
  }

  /** Covered length in (-inf, x]. */
  private coveredUntil(x: number): number {
    // Last interval whose start is <= x.
    let lo = 0;
    let hi = this.starts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= x) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return 0;
    return this.cumulative[found] + Math.min(x, this.ends[found]) - this.starts[found];
  }

  /** Covered length inside [from, to]. */
  overlap(from: number, to: number): number {
    if (!(to > from) || this.starts.length === 0) return 0;
    return this.coveredUntil(to) - this.coveredUntil(from);
  }
}
