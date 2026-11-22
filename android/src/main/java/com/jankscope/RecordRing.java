package com.jankscope;

/**
 * A fixed-capacity ring of fixed-size records of longs (microseconds). When it
 * is full the oldest record is overwritten and counted in {@link #lost()}.
 * Thread-safe: writers on the UI thread, the FrameMetrics thread and the
 * module thread, readers on the module thread. Uses no Android types, so it is
 * tested on a plain JVM (scripts/android-jvm-test.sh).
 */
final class RecordRing {
  private final int stride;
  private final long[] data;
  private final int capacity;
  private long written;
  private long peeked;

  RecordRing(int stride, int capacity) {
    if (stride <= 0 || capacity <= 0) throw new IllegalArgumentException("stride and capacity must be positive");
    this.stride = stride;
    this.capacity = capacity;
    this.data = new long[stride * capacity];
  }

  int stride() {
    return stride;
  }

  /** Append one record; {@code record.length} must equal the stride. */
  synchronized void add(long[] record) {
    int slot = (int) (written % capacity);
    System.arraycopy(record, 0, data, slot * stride, stride);
    written++;
  }

  /** Records overwritten before they were read by {@link #appendAll}. */
  synchronized long lost() {
    return Math.max(0, written - capacity);
  }

  synchronized long size() {
    return Math.min(written, capacity);
  }

  /** Append every stored record, oldest first, as comma-separated numbers. */
  synchronized void appendAll(StringBuilder out) {
    appendFrom(out, Math.max(0, written - capacity));
  }

  /** Append the records written since the previous call (or since the oldest stored one). */
  synchronized void appendSincePeek(StringBuilder out) {
    long from = Math.max(peeked, Math.max(0, written - capacity));
    appendFrom(out, from);
    peeked = written;
  }

  private void appendFrom(StringBuilder out, long from) {
    boolean first = true;
    for (long index = from; index < written; index++) {
      int base = (int) (index % capacity) * stride;
      for (int i = 0; i < stride; i++) {
        if (!first) out.append(',');
        out.append(data[base + i]);
        first = false;
      }
    }
  }
}
