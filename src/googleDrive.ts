import { DEFAULT_THEMES, parseStoredGoogleSession } from "./uiLogic";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const DATA_FILE_NAME = "supper-shuffle-data.json";
const DATA_FILE_STORAGE_KEY = "supper-shuffle-appdata-file-id";
const LEGACY_SPREADSHEET_STORAGE_KEY = "supper-shuffle-spreadsheet-id";
const GOOGLE_SESSION_STORAGE_KEY = "supper-shuffle-google-session";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type?: string }) => void;
          }) => TokenClient;
          revoke: (token: string, callback?: () => void) => void;
        };
      };
    };
  }
}

type MealRow = { id: string; name: string; theme: string };
type IngredientRow = { id: string; mealId: string; ingredient: string };
type HistoryRow = { id: string; week: string; mealId: string };
type ShoppingRow = { id: string; week: string; ingredient: string; removed: boolean; manual: boolean };
type EssentialRow = { id: string; name: string };
type AppData = {
  schemaVersion: 1;
  weekStartsOn: "Saturday";
  timeZone: "America/Chicago";
  themes: string[];
  meals: MealRow[];
  ingredients: IngredientRow[];
  history: HistoryRow[];
  shopping: ShoppingRow[];
  essentials: EssentialRow[];
};

let accessToken = "";
let expiresAt = 0;
let dataFileId = "";
let dataCache: AppData | null = null;
let tokenClient: TokenClient | null = null;
let mutationQueue: Promise<void> = Promise.resolve();
let restorePromise: Promise<boolean> | null = null;
const expiredListeners = new Set<() => void>();

function clientId() {
  return String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
}

export function isGoogleConfigured() {
  return Boolean(clientId());
}

export function onGoogleAuthorizationExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

function expireAuthorization() {
  accessToken = "";
  expiresAt = 0;
  dataFileId = "";
  dataCache = null;
  clearStoredAuthorization();
  expiredListeners.forEach((listener) => listener());
}

function storeAuthorization() {
  try {
    sessionStorage.setItem(GOOGLE_SESSION_STORAGE_KEY, JSON.stringify({ accessToken, expiresAt }));
  } catch {
    // The in-memory session remains usable when browser storage is unavailable.
  }
}

function clearStoredAuthorization() {
  try {
    sessionStorage.removeItem(GOOGLE_SESSION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restrictive browser modes.
  }
}

function restoreStoredAuthorization() {
  try {
    const stored = parseStoredGoogleSession(sessionStorage.getItem(GOOGLE_SESSION_STORAGE_KEY));
    if (!stored) {
      clearStoredAuthorization();
      return false;
    }
    accessToken = stored.accessToken;
    expiresAt = stored.expiresAt;
    return true;
  } catch {
    clearStoredAuthorization();
    return false;
  }
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google sign-in could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in could not be loaded."));
    document.head.append(script);
  });
}

export async function connectGoogle() {
  const id = clientId();
  if (!id) throw new Error("Google sign-in has not been configured yet.");
  await loadGoogleIdentityServices();
  return new Promise<{ dataFileId: string }>((resolve, reject) => {
    const google = window.google;
    if (!google) return reject(new Error("Google sign-in could not be initialized."));
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (!response.access_token) return reject(new Error(response.error_description || response.error || "Google authorization was not completed."));
        accessToken = response.access_token;
        expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 3600) - 30) * 1000;
        storeAuthorization();
        void ensureUserDataFile().then((fileId) => resolve({ dataFileId: fileId })).catch(reject);
      },
      error_callback: () => reject(new Error("The Google authorization window was closed.")),
    });
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

export function restoreGoogleSession() {
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    if (!restoreStoredAuthorization()) return false;
    try {
      await ensureUserDataFile();
      return true;
    } catch {
      expireAuthorization();
      return false;
    }
  })().finally(() => {
    restorePromise = null;
  });
  return restorePromise;
}

export function disconnectGoogle() {
  accessToken = "";
  expiresAt = 0;
  dataFileId = "";
  dataCache = null;
  clearStoredAuthorization();
}

function requireAuthorization() {
  if (!accessToken || Date.now() >= expiresAt) {
    expireAuthorization();
    throw new Error("Your Google connection expired. Please reconnect to continue.");
  }
}

async function googleFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  requireAuthorization();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const errorData = data as { error?: { status?: string; message?: string } } | null;
    if (response.status === 401 || errorData?.error?.status === "UNAUTHENTICATED") expireAuthorization();
    throw new Error(errorData?.error?.message || "Google could not complete the request.");
  }
  return data as T;
}

function emptyAppData(): AppData {
  return {
    schemaVersion: 1,
    weekStartsOn: "Saturday",
    timeZone: "America/Chicago",
    themes: [...DEFAULT_THEMES],
    meals: [],
    ingredients: [],
    history: [],
    shopping: [],
    essentials: ["Salt", "Pepper", "Olive Oil", "Butter"].map((name) => ({ id: crypto.randomUUID(), name })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAppData(value: unknown): AppData {
  if (!isRecord(value)) throw new Error("Your Supper Shuffle data could not be read.");
  const array = (key: string) => Array.isArray(value[key]) ? value[key] as unknown[] : [];
  const meals = array("meals").filter(isRecord).map((item) => ({ id: stringValue(item.id), name: stringValue(item.name), theme: stringValue(item.theme) || "Other" })).filter((item) => item.id && item.name);
  const storedThemes = array("themes").map(stringValue).filter(Boolean);
  const themes = [...DEFAULT_THEMES, ...storedThemes, ...meals.map((meal) => meal.theme)].filter((theme, index, all) => all.findIndex((item) => canonical(item) === canonical(theme)) === index);
  return {
    schemaVersion: 1,
    weekStartsOn: "Saturday",
    timeZone: "America/Chicago",
    themes,
    meals,
    ingredients: array("ingredients").filter(isRecord).map((item) => ({ id: stringValue(item.id), mealId: stringValue(item.mealId), ingredient: stringValue(item.ingredient) })).filter((item) => item.id && item.mealId && item.ingredient),
    history: array("history").filter(isRecord).map((item) => ({ id: stringValue(item.id), week: stringValue(item.week), mealId: stringValue(item.mealId) })).filter((item) => item.id && item.week && item.mealId),
    shopping: array("shopping").filter(isRecord).map((item) => ({ id: stringValue(item.id), week: stringValue(item.week), ingredient: stringValue(item.ingredient), removed: Boolean(item.removed), manual: Boolean(item.manual) })).filter((item) => item.id && item.week && item.ingredient),
    essentials: array("essentials").filter(isRecord).map((item) => ({ id: stringValue(item.id), name: stringValue(item.name) })).filter((item) => item.id && item.name),
  };
}

async function findUserDataFile() {
  const params = new URLSearchParams({
    q: `name='${DATA_FILE_NAME}'`,
    spaces: "appDataFolder",
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "10",
  });
  const result = await googleFetch<{ files?: Array<{ id: string }> }>(`${DRIVE_API}?${params}`);
  return result.files?.[0]?.id || "";
}

async function dataFileIsAvailable(fileId: string) {
  try {
    await googleFetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?fields=id`);
    return true;
  } catch (error) {
    if ((error as Error).message.toLocaleLowerCase().includes("file not found")) return false;
    throw error;
  }
}

async function createUserDataFile() {
  const result = await googleFetch<{ id: string }>(`${DRIVE_API}?fields=id`, {
    method: "POST",
    body: JSON.stringify({ name: DATA_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" }),
  });
  dataFileId = result.id;
  const initialData = emptyAppData();
  await writeData(initialData);
  return result.id;
}

async function ensureUserDataFile() {
  localStorage.removeItem(LEGACY_SPREADSHEET_STORAGE_KEY);
  const remembered = localStorage.getItem(DATA_FILE_STORAGE_KEY) || "";
  let fileId = remembered && await dataFileIsAvailable(remembered) ? remembered : "";
  if (!fileId) fileId = await findUserDataFile();
  if (!fileId) fileId = await createUserDataFile();
  dataFileId = fileId;
  localStorage.setItem(DATA_FILE_STORAGE_KEY, fileId);
  dataCache = await readData();
  return fileId;
}

async function readData() {
  if (!dataFileId) throw new Error("Supper Shuffle storage has not been initialized.");
  const data = await googleFetch<unknown>(`${DRIVE_API}/${encodeURIComponent(dataFileId)}?alt=media`);
  return normalizeAppData(data);
}

async function writeData(data: AppData) {
  if (!dataFileId) throw new Error("Supper Shuffle storage has not been initialized.");
  await googleFetch(`${DRIVE_UPLOAD_API}/${encodeURIComponent(dataFileId)}?uploadType=media&fields=id`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  dataCache = data;
}

async function loadData() {
  if (!dataCache) dataCache = await readData();
  return dataCache;
}

function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function canonical(value: string) {
  return value.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

function chicagoToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return new Date(Date.UTC(values.year, values.month - 1, values.day));
}

function currentWeekStart() {
  const result = chicagoToday();
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 1) % 7));
  return `${result.getUTCMonth() + 1}/${result.getUTCDate()}/${result.getUTCFullYear()}`;
}

function parseDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]))) : null;
}

function historyDate(date: Date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

function mealsPayload(data: AppData) {
  const lastOrdered = new Map<string, Date>();
  for (const history of data.history) {
    const date = parseDate(history.week);
    if (!date) continue;
    const prior = lastOrdered.get(history.mealId);
    if (!prior || date > prior) lastOrdered.set(history.mealId, date);
  }
  return data.meals.map((meal) => ({ id: meal.id, name: meal.name, theme: meal.theme, lastOrdered: lastOrdered.has(meal.id) ? historyDate(lastOrdered.get(meal.id)!) : "" }));
}

function mealDetail(data: AppData, mealId: string) {
  const meal = mealsPayload(data).find((item) => item.id === mealId);
  if (!meal) throw new Error("Meal not found.");
  return { ...meal, ingredients: data.ingredients.filter((item) => item.mealId === mealId).map((item) => item.ingredient) };
}

function weekPayload(data: AppData) {
  const weekStart = currentWeekStart();
  const selected = new Set(data.history.filter((item) => item.week === weekStart).map((item) => item.mealId));
  const meals = mealsPayload(data).filter((meal) => selected.has(meal.id));
  return { weekStart, meals, count: meals.length };
}

function shoppingPayload(data: AppData) {
  const week = weekPayload(data);
  const grouped = new Map<string, { ingredient: string; meals: string[] }>();
  for (const meal of week.meals) {
    for (const row of data.ingredients.filter((item) => item.mealId === meal.id)) {
      const key = canonical(row.ingredient);
      const entry = grouped.get(key) || { ingredient: row.ingredient, meals: [] };
      if (!entry.meals.includes(meal.name)) entry.meals.push(meal.name);
      grouped.set(key, entry);
    }
  }
  const saved = new Map(data.shopping.filter((item) => item.week === week.weekStart).map((item) => [canonical(item.ingredient), item]));
  const items: Array<{ id: string; ingredient: string; quantity: string; meals: string[] }> = [];
  for (const [key, item] of grouped) {
    if (saved.get(key)?.removed) continue;
    items.push({ id: key, ingredient: item.ingredient, quantity: String(item.meals.length), meals: item.meals });
  }
  for (const [key, item] of saved) {
    if (grouped.has(key) || item.removed || !item.manual) continue;
    items.push({ id: key, ingredient: item.ingredient, quantity: "1", meals: [] });
  }
  items.sort((left, right) => left.ingredient.localeCompare(right.ingredient));
  return { weekStart: week.weekStart, items, count: items.length };
}

function body(options?: RequestInit) {
  return options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : {};
}

async function readApi<T>(method: string, url: URL, parts: string[], data: AppData): Promise<T> {
  if (method === "GET" && url.pathname === "/api/meals") {
    const meals = mealsPayload(data);
    return { meals, themes: data.themes, count: meals.length } as T;
  }
  if (method === "GET" && url.pathname === "/api/week") return weekPayload(data) as T;
  if (method === "GET" && url.pathname === "/api/shopping-list") return shoppingPayload(data) as T;
  if (method === "GET" && url.pathname === "/api/essentials") {
    const orderCounts = new Map<string, number>();
    for (const item of data.shopping) {
      if (item.manual && !item.removed) orderCounts.set(canonical(item.ingredient), (orderCounts.get(canonical(item.ingredient)) || 0) + 1);
    }
    const essentials = data.essentials.map((item) => ({ name: item.name, defaultQuantity: "1", orderCount: orderCounts.get(canonical(item.name)) || 0 }));
    return { essentials, count: essentials.length } as T;
  }
  if (method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "meals") return { meal: mealDetail(data, parts[2]) } as T;
  throw new Error("This action is not available.");
}

async function mutateApi<T>(method: string, url: URL, parts: string[], options: RequestInit): Promise<T> {
  const data = structuredClone(await loadData());
  if (method === "POST" && url.pathname === "/api/meals") {
    const request = body(options);
    const name = String(request.name || "").trim();
    const theme = String(request.theme || "").trim();
    if (!name || !theme) throw new Error("Meal name and theme are required.");
    if (data.meals.some((meal) => canonical(meal.name) === canonical(name))) throw new Error("That meal already exists.");
    const id = crypto.randomUUID();
    data.meals.push({ id, name, theme });
    if (!data.themes.some((item) => canonical(item) === canonical(theme))) data.themes.push(theme);
    await writeData(data);
    return { meal: mealDetail(data, id), count: data.meals.length } as T;
  }
  if (method === "DELETE" && parts.length === 3 && parts[0] === "api" && parts[1] === "meals") {
    const mealIndex = data.meals.findIndex((item) => item.id === parts[2]);
    if (mealIndex < 0) throw new Error("Meal not found.");
    data.meals.splice(mealIndex, 1);
    data.ingredients = data.ingredients.filter((item) => item.mealId !== parts[2]);
    data.history = data.history.filter((item) => item.mealId !== parts[2]);
    await writeData(data);
    return { ok: true, id: parts[2], count: data.meals.length } as T;
  }
  if (method === "PATCH" && parts.length === 3 && parts[0] === "api" && parts[1] === "meals") {
    const meal = data.meals.find((item) => item.id === parts[2]);
    if (!meal) throw new Error("Meal not found.");
    const request = body(options);
    const name = String(request.name || "").trim();
    const theme = String(request.theme || "").trim();
    if (!name || !theme) throw new Error("Meal name and theme are required.");
    if (data.meals.some((item) => item.id !== meal.id && canonical(item.name) === canonical(name))) throw new Error("That meal already exists.");
    meal.name = name;
    meal.theme = theme;
    if (!data.themes.some((item) => canonical(item) === canonical(theme))) data.themes.push(theme);
    await writeData(data);
    return { meal: mealDetail(data, meal.id) } as T;
  }
  if (method === "POST" && url.pathname === "/api/week") {
    const mealId = String(body(options).mealId || "");
    if (!data.meals.some((meal) => meal.id === mealId)) throw new Error("Meal not found.");
    const weekStart = currentWeekStart();
    if (!data.history.some((item) => item.week === weekStart && item.mealId === mealId)) data.history.push({ id: crypto.randomUUID(), week: weekStart, mealId });
    await writeData(data);
    return weekPayload(data) as T;
  }
  if (method === "DELETE" && parts.length === 3 && parts[0] === "api" && parts[1] === "week") {
    const index = data.history.findIndex((item) => item.week === currentWeekStart() && item.mealId === parts[2]);
    if (index >= 0) data.history.splice(index, 1);
    await writeData(data);
    return weekPayload(data) as T;
  }
  if (method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "meals" && parts[3] === "ingredients") {
    const name = String(body(options).name || "").trim();
    if (!name) throw new Error("Ingredient is required.");
    if (!data.meals.some((meal) => meal.id === parts[2])) throw new Error("Meal not found.");
    if (data.ingredients.some((item) => item.mealId === parts[2] && canonical(item.ingredient) === canonical(name))) throw new Error("That ingredient is already on this meal.");
    data.ingredients.push({ id: crypto.randomUUID(), mealId: parts[2], ingredient: name });
    await writeData(data);
    return { meal: mealDetail(data, parts[2]) } as T;
  }
  if (["PATCH", "DELETE"].includes(method) && parts.length === 5 && parts[0] === "api" && parts[1] === "meals" && parts[3] === "ingredients") {
    const ingredientRows = data.ingredients.filter((item) => item.mealId === parts[2]);
    const match = ingredientRows[Number(parts[4])];
    if (!match) throw new Error("Ingredient not found.");
    if (method === "DELETE") data.ingredients = data.ingredients.filter((item) => item.id !== match.id);
    else {
      const name = String(body(options).name || "").trim();
      if (!name) throw new Error("Ingredient is required.");
      match.ingredient = name;
    }
    await writeData(data);
    return { meal: mealDetail(data, parts[2]) } as T;
  }
  if (["PATCH", "DELETE"].includes(method) && parts.length === 3 && parts[0] === "api" && parts[1] === "shopping-list") {
    const ingredient = parts[2].trim();
    const week = currentWeekStart();
    const match = data.shopping.find((item) => item.week === week && canonical(item.ingredient) === canonical(ingredient));
    const removed = method === "DELETE";
    const manual = method === "PATCH" || Boolean(match?.manual);
    if (match) {
      match.ingredient = ingredient;
      match.removed = removed;
      match.manual = manual;
    } else data.shopping.push({ id: crypto.randomUUID(), week, ingredient, removed, manual });
    await writeData(data);
    return { ok: true, ingredient } as T;
  }
  if (method === "POST" && url.pathname === "/api/essentials") {
    const name = String(body(options).name || "").trim();
    if (!name) throw new Error("A pantry item needs a name.");
    if (data.essentials.some((item) => canonical(item.name) === canonical(name))) throw new Error("That pantry item already exists.");
    const essential = { id: crypto.randomUUID(), name };
    data.essentials.push(essential);
    await writeData(data);
    return { essential: { name: essential.name, defaultQuantity: "1", orderCount: 0 } } as T;
  }
  if (method === "DELETE" && parts.length === 3 && parts[0] === "api" && parts[1] === "essentials") {
    const name = parts[2].trim();
    const index = data.essentials.findIndex((item) => canonical(item.name) === canonical(name));
    if (index < 0) throw new Error("Pantry item not found.");
    data.essentials.splice(index, 1);
    await writeData(data);
    return { ok: true, name } as T;
  }
  throw new Error("This action is not available.");
}

export async function googleApi<T>(rawUrl: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || "GET").toUpperCase();
  const url = new URL(rawUrl, window.location.origin);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (method === "GET") return readApi(method, url, parts, await loadData());
  return mutate(() => mutateApi<T>(method, url, parts, options));
}
