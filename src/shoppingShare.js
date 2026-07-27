/**
 * Formats the remaining shopping list as compact plain text for messaging apps.
 * Checked-off items are intentionally omitted.
 *
 * @param {{
 *   weekLabel: string,
 *   items: Array<{ ingredient: string, quantity: string, shopped: boolean }>
 * }} input
 */
export function formatShoppingListText({ weekLabel, items }) {
  const remainingItems = items.filter((item) => !item.shopped);
  const lines = [
    "Supper Shuffle Shopping List",
    `Week of ${weekLabel}`,
    "",
    ...remainingItems.map((item) => `- ${item.ingredient} (Qty ${item.quantity})`),
  ];

  return lines.join("\n");
}
