import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { placeLeft, placeRight } from "./border.ts";

const border = (width: number) => "─".repeat(width);

for (const width of [80, 40, 20]) {
  test(`right labels fit width ${width}`, () => {
    const line = placeRight(border(width), " scripted · high ", width);
    assert.equal(visibleWidth(line), width);
    if (width >= visibleWidth(" scripted · high ")) assert.ok(line.endsWith(" scripted · high "));
  });

  test(`left labels fit width ${width}`, () => {
    const line = placeLeft(border(width), " stashed ", width);
    assert.equal(visibleWidth(line), width);
    if (width >= visibleWidth(" stashed ")) assert.ok(line.startsWith(" stashed "));
  });

  test(`CJK labels keep the border width ${width}`, () => {
    const right = placeRight(border(width), " 模型 · 高 ", width);
    const left = placeLeft(border(width), " 暂存 ", width);
    assert.equal(visibleWidth(right), width);
    assert.equal(visibleWidth(left), width);
  });
}

test("labels longer than the border are truncated to its width", () => {
  const line = placeRight(border(10), " a very long model label ", 10);
  assert.equal(visibleWidth(line), 10);
  assert.ok(!line.includes("label"));
});

test("left then right placement keeps both labels apart", () => {
  const line = placeRight(placeLeft(border(40), " stashed ", 40), " scripted · high ", 40);
  assert.equal(visibleWidth(line), 40);
  assert.ok(line.startsWith(" stashed "));
  assert.ok(line.endsWith(" scripted · high "));
});
