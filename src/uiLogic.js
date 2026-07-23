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
 * @param {...string[]} groups
 * @returns {string[]}
 */
export function mergeThemeOptions(...groups) {
  const themes = new Map();
  for (const theme of groups.flat()) {
    const value = theme.trim();
    if (value && !themes.has(value.toLocaleLowerCase())) themes.set(value.toLocaleLowerCase(), value);
  }
  return [...themes.values()].sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string | null} rawValue
 * @param {number} now
 * @returns {{ accessToken: string, expiresAt: number } | null}
 */
export function parseStoredGoogleSession(rawValue, now = Date.now()) {
  if (!rawValue) return null;
  try {
    const stored = JSON.parse(rawValue);
    if (!stored || typeof stored.accessToken !== "string" || !stored.accessToken || typeof stored.expiresAt !== "number" || !Number.isFinite(stored.expiresAt) || stored.expiresAt <= now) return null;
    return { accessToken: stored.accessToken, expiresAt: stored.expiresAt };
  } catch {
    return null;
  }
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
