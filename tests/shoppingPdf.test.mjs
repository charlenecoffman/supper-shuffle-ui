import test from "node:test";
import assert from "node:assert/strict";
import { buildShoppingListPdf } from "../src/shoppingPdf.js";

test("shopping list downloads as a valid PDF containing the weekly items", () => {
  const bytes = buildShoppingListPdf({
    weekLabel: "July 18, 2026",
    items: [{ ingredient: "Cheese", quantity: "2", meals: ["Street Tacos", "Quesadillas"] }],
  });
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /Cheese  -  Qty 2/);
  assert.match(text, /Street Tacos, Quesadillas/);
  assert.match(text, /%%EOF$/);
});
