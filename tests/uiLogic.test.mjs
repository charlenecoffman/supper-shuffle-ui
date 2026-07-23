import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEMES, filterThemeOptions, rankPantryItems, shouldCloseFromBackdrop } from "../src/uiLogic.js";

test("the dropdown arrow can show every starter theme", () => {
  assert.deepEqual(filterThemeOptions(DEFAULT_THEMES, "", true), DEFAULT_THEMES);
  assert.ok(DEFAULT_THEMES.includes("Italian"));
  assert.ok(DEFAULT_THEMES.includes("Mexican"));
});

test("typing opens only case-insensitive matching suggestions", () => {
  assert.deepEqual(filterThemeOptions(DEFAULT_THEMES, "an", false), ["American", "Asian", "Italian", "Mediterranean", "Mexican"]);
  assert.deepEqual(filterThemeOptions(DEFAULT_THEMES, "MEX", false), ["Mexican"]);
});

test("custom theme text remains valid when there are no suggestions", () => {
  assert.deepEqual(filterThemeOptions(DEFAULT_THEMES, "Moon Picnic", false), []);
});

test("a modal closes only when the pointer press and click both occur on its backdrop", () => {
  assert.equal(shouldCloseFromBackdrop(true, true), true);
  assert.equal(shouldCloseFromBackdrop(true, false), false);
  assert.equal(shouldCloseFromBackdrop(false, true), false);
});

test("pantry check shows the five most frequently ordered staples", () => {
  const items = [
    { name: "Salt", orderCount: 2 },
    { name: "Pepper", orderCount: 5 },
    { name: "Butter", orderCount: 4 },
    { name: "Olive Oil", orderCount: 3 },
    { name: "Flour", orderCount: 1 },
    { name: "Sugar", orderCount: 6 },
  ];
  assert.deepEqual(rankPantryItems(items).map((item) => item.name), ["Sugar", "Pepper", "Butter", "Olive Oil", "Salt"]);
});
