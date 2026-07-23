export const DEFAULT_THEMES = ["American", "Asian", "British", "Cajun", "Italian", "Mediterranean", "Mexican"];

/**
 * @param {string[]} options
 * @param {string} value
 * @param {boolean} showAll
 * @returns {string[]}
 */
export function filterThemeOptions(options, value, showAll) {
  if (showAll || !value.trim()) return options;
  const query = value.trim().toLocaleLowerCase();
  return options.filter((option) => option.toLocaleLowerCase().includes(query));
}

/**
 * @param {boolean} targetIsDialog
 * @param {boolean} pressStartedOnBackdrop
 * @returns {boolean}
 */
export function shouldCloseFromBackdrop(targetIsDialog, pressStartedOnBackdrop) {
  return targetIsDialog && pressStartedOnBackdrop;
}

/**
 * @template {{ name: string, orderCount?: number }} T
 * @param {T[]} items
 * @param {number} limit
 * @returns {T[]}
 */
export function rankPantryItems(items, limit = 5) {
  return [...items]
    .sort((left, right) => (right.orderCount || 0) - (left.orderCount || 0) || left.name.localeCompare(right.name))
    .slice(0, limit);
}
