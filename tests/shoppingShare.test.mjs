import test from "node:test";
import assert from "node:assert/strict";
import { formatShoppingListText } from "../src/shoppingShare.js";

test("shopping list share text is concise and excludes checked-off items", () => {
  const text = formatShoppingListText({
    weekLabel: "July 26, 2026",
    items: [
      { ingredient: "Chicken breasts", quantity: "2", shopped: false },
      { ingredient: "Limes", quantity: "3", shopped: true },
      { ingredient: "Rice", quantity: "1", shopped: false },
    ],
  });

  assert.equal(
    text,
    [
      "Supper Shuffle Shopping List",
      "Week of July 26, 2026",
      "",
      "- Chicken breasts (Qty 2)",
      "- Rice (Qty 1)",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /Limes/);
});
