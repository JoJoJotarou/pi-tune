import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSize, isLargePaste, markerAt, removeMarker, replaceMarker } from "./paste.ts";

test("finds line and character paste markers at the cursor", () => {
  const lines = "before [paste #1 +28 lines] after";
  assert.deepEqual(markerAt(lines, 7), { id: 1, start: 7, end: 27 });
  assert.deepEqual(markerAt(lines, 26), { id: 1, start: 7, end: 27 });
  assert.deepEqual(markerAt(lines, 27), { id: 1, start: 7, end: 27 });
  assert.equal(markerAt(lines, 6), undefined);
  assert.equal(markerAt(lines, 28), undefined);

  const chars = "x [paste #4 512 chars]";
  assert.deepEqual(markerAt(chars, 4), { id: 4, start: 2, end: 22 });
});

test("replaces and removes only the requested paste marker", () => {
  const text = "a [paste #1 +2 lines] b [paste #2 512 chars] c";
  assert.equal(replaceMarker(text, 1, "one\ntwo"), "a one\ntwo b [paste #2 512 chars] c");
  assert.equal(removeMarker(text, 2), "a [paste #1 +2 lines] b  c");
  assert.equal(replaceMarker(text, 9, "nope"), text);
});

test("large paste means more than ten lines or more than one thousand characters", () => {
  assert.equal(isLargePaste(Array.from({ length: 10 }, () => "x").join("\n")), false);
  assert.equal(isLargePaste(Array.from({ length: 11 }, () => "x").join("\n")), true);
  assert.equal(isLargePaste("x".repeat(1000)), false);
  assert.equal(isLargePaste("x".repeat(1001)), true);
});

test("formats byte sizes compactly", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(2150), "2.1 KB");
  assert.equal(formatSize(1024 * 1024), "1.0 MB");
});
