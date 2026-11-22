package com.jankscope;

/** Plain-JVM checks of RecordRing. Run with scripts/android-jvm-test.sh. */
public final class RecordRingJvmTest {
  private static int failures;

  private static void check(boolean condition, String name) {
    if (condition) {
      System.out.println("ok   " + name);
    } else {
      failures++;
      System.out.println("FAIL " + name);
    }
  }

  private static String all(RecordRing ring) {
    StringBuilder out = new StringBuilder();
    ring.appendAll(out);
    return out.toString();
  }

  private static String peek(RecordRing ring) {
    StringBuilder out = new StringBuilder();
    ring.appendSincePeek(out);
    return out.toString();
  }

  public static void main(String[] args) {
    RecordRing ring = new RecordRing(2, 3);
    check(all(ring).isEmpty(), "empty ring prints nothing");
    ring.add(new long[] {1, 2});
    ring.add(new long[] {3, 4});
    check(all(ring).equals("1,2,3,4"), "records print oldest first");
    check(peek(ring).equals("1,2,3,4"), "first peek returns everything");
    check(peek(ring).isEmpty(), "second peek returns nothing new");
    ring.add(new long[] {5, 6});
    ring.add(new long[] {7, 8});
    check(all(ring).equals("3,4,5,6,7,8"), "a full ring overwrites the oldest record");
    check(ring.lost() == 1, "overwritten records are counted");
    check(ring.size() == 3, "size is capped at the capacity");
    check(peek(ring).equals("5,6,7,8"), "peek returns only records written since the last peek");
    for (int i = 0; i < 10; i++) ring.add(new long[] {i, -1});
    check(peek(ring).equals("7,-1,8,-1,9,-1"), "peek after an overrun returns the stored records only");
    boolean threw = false;
    try {
      new RecordRing(0, 1);
    } catch (IllegalArgumentException expected) {
      threw = true;
    }
    check(threw, "a zero stride is rejected");
    if (failures > 0) {
      System.out.println(failures + " failed");
      System.exit(1);
    }
    System.out.println("all passed");
  }
}
