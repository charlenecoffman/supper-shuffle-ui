import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { connectGoogle, googleApi as api, isGoogleConfigured, onGoogleAuthorizationExpired, restoreGoogleSession } from "./googleDrive";
import { buildShoppingListPdf } from "./shoppingPdf";
import { filterThemeOptions, mergeThemeOptions, rankPantryItems, shouldCloseFromBackdrop } from "./uiLogic";

type Meal = { id: string; name: string; theme: string; lastOrdered?: string };
type MealDetail = Meal & { ingredients: string[] };
type WeekPayload = { weekStart: string; meals: Meal[]; count: number };
type ShoppingItem = { id: string; ingredient: string; quantity: string; meals: string[] };
type Essential = { name: string; defaultQuantity: string; orderCount?: number };
type Message = { text: string; error?: boolean };

const emojiByTheme: Record<string, string> = {
  Mexican: "🌮",
  Italian: "🍝",
  Asian: "🍛",
  Cajun: "🥘",
  American: "🍔",
  British: "🥧",
  Mediterranean: "🫓",
};

function mealKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

function formatWeek(value: string) {
  if (!value) return "this week";
  return new Date(`${value} 12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

type ThemeComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  name?: string;
  compact?: boolean;
};

function ThemeCombobox({ value, onChange, options, name, compact = false }: ThemeComboboxProps) {
  const inputId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => filterThemeOptions(options, value, showAll), [options, showAll, value]);

  function choose(option: string) {
    onChange(option);
    setOpen(false);
    setShowAll(false);
    setActiveIndex(0);
    inputRef.current?.focus();
  }

  function handleInput(nextValue: string) {
    onChange(nextValue);
    setShowAll(false);
    setActiveIndex(0);
    const query = nextValue.trim().toLocaleLowerCase();
    setOpen(Boolean(query) && options.some((option) => option.toLocaleLowerCase().includes(query)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setShowAll(!value.trim());
        setOpen(true);
        setActiveIndex(0);
      } else setActiveIndex((index) => Math.min(index + 1, Math.max(0, matches.length - 1)));
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open && matches[activeIndex]) {
      event.preventDefault();
      choose(matches[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`theme-combobox-field ${compact ? "meal-theme-field" : ""}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <label htmlFor={inputId}>Theme</label>
      <div className="theme-combobox">
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          value={value}
          onChange={(event) => handleInput(event.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          maxLength={60}
          placeholder="e.g. Italian"
          autoComplete="off"
          required
        />
        <button type="button" className="theme-combobox-toggle" aria-label="Show theme suggestions" aria-expanded={open} onClick={() => {
          setShowAll(true);
          setActiveIndex(0);
          setOpen((current) => !current || !showAll);
          inputRef.current?.focus();
        }}>▾</button>
        {open && matches.length > 0 && <div className="theme-combobox-options" id={listId} role="listbox">
          {matches.map((option, index) => <button
            id={`${listId}-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? "active" : ""}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(option)}
            key={option}
          >{option}</button>)}
        </div>}
      </div>
    </div>
  );
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [session, setSession] = useState(0);

  useEffect(() => onGoogleAuthorizationExpired(() => {
    setConnected(false);
    setConnectionError("Your Google connection expired. Reconnect to keep shuffling.");
  }), []);

  useEffect(() => {
    let active = true;
    void restoreGoogleSession().then((restored) => {
      if (!active) return;
      setConnected(restored);
      setRestoringSession(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setConnectionError("");
    try {
      await connectGoogle();
      setSession((value) => value + 1);
      setConnected(true);
    } catch (error) {
      setConnectionError((error as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  if (connected) return <Home key={session} />;

  return (
    <main className="google-connect-page">
      <section className="google-connect-card">
        <img src="/favicon.png" alt="" />
        <p className="eyebrow">SUPPER SHUFFLE</p>
        <h1>Your meals,<br />in your Drive.</h1>
        <p className="google-connect-copy">Connect Google to create or reopen your private Supper Shuffle data. It stays hidden in your Google Drive app storage and is only accessible to Supper Shuffle.</p>
        <button className="google-connect-button" onClick={() => void handleConnect()} disabled={restoringSession || connecting || !isGoogleConfigured()}>
          <span aria-hidden="true">G</span>{restoringSession ? "Restoring session…" : connecting ? "Connecting…" : "Continue with Google"}
        </button>
        {!isGoogleConfigured() && <p className="google-connect-error">Google sign-in needs a web client ID before it can be used.</p>}
        {connectionError && <p className="google-connect-error" role="alert">{connectionError}</p>}
        <p className="google-connect-note">Google access is kept only for this browser tab and expires automatically.</p>
      </section>
    </main>
  );
}

function Home() {
  const [view, setView] = useState<"meals" | "week" | "pantry">("meals");
  const [meals, setMeals] = useState<Meal[]>([]);
  const [planned, setPlanned] = useState<Meal[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [pantryCheckExcludedKeys, setPantryCheckExcludedKeys] = useState<Set<string>>(new Set());
  const [pantryCheckLeavingKeys, setPantryCheckLeavingKeys] = useState<Set<string>>(new Set());
  const [pantryCheckEnteringKey, setPantryCheckEnteringKey] = useState("");
  const [essentials, setEssentials] = useState<Essential[]>([]);
  const [newEssentialName, setNewEssentialName] = useState("");
  const [addingEssential, setAddingEssential] = useState(false);
  const [savedThemes, setSavedThemes] = useState<string[]>([]);
  const [theme, setTheme] = useState("All meals");
  const [mealSearch, setMealSearch] = useState("");
  const [shoppingSearch, setShoppingSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [weekMessage, setWeekMessage] = useState<Message>({ text: "" });
  const [shoppingMessage, setShoppingMessage] = useState<Message>({ text: "" });
  const [pantryMessage, setPantryMessage] = useState<Message>({ text: "" });
  const [activeMeal, setActiveMeal] = useState<MealDetail | null>(null);
  const [editingMealName, setEditingMealName] = useState(false);
  const [mealNameInput, setMealNameInput] = useState("");
  const [mealThemeInput, setMealThemeInput] = useState("");
  const [mealNameError, setMealNameError] = useState("");
  const [savingMealName, setSavingMealName] = useState(false);
  const [mealDialogOpen, setMealDialogOpen] = useState(false);
  const [addMealOpen, setAddMealOpen] = useState(false);
  const [mealPendingDelete, setMealPendingDelete] = useState<Meal | null>(null);
  const [deletingMeal, setDeletingMeal] = useState(false);
  const [deleteMealError, setDeleteMealError] = useState("");
  const [ingredientInput, setIngredientInput] = useState("");
  const [ingredientMessage, setIngredientMessage] = useState("");
  const [pendingIngredients, setPendingIngredients] = useState<Set<string>>(new Set());
  const [editIngredient, setEditIngredient] = useState<{ index: number; value: string } | null>(null);
  const [addMealError, setAddMealError] = useState("");
  const [addingMeal, setAddingMeal] = useState(false);
  const [newMealName, setNewMealName] = useState("");
  const [newMealTheme, setNewMealTheme] = useState("");
  const mealDialogRef = useRef<HTMLDialogElement>(null);
  const addMealDialogRef = useRef<HTMLDialogElement>(null);
  const deleteMealDialogRef = useRef<HTMLDialogElement>(null);
  const mealBackdropPressRef = useRef(false);
  const addMealBackdropPressRef = useRef(false);
  const deleteMealBackdropPressRef = useRef(false);
  const ingredientInputRef = useRef<HTMLInputElement>(null);
  const ingredientFormRef = useRef<HTMLFormElement>(null);
  const pantryCheckTimersRef = useRef<Map<string, number[]>>(new Map());
  const previousPantryCheckKeysRef = useRef<string[] | null>(null);
  const pantryCheckEntranceTimerRef = useRef<number | null>(null);
  const plannedKeys = useMemo(() => new Set(planned.map((meal) => mealKey(meal.name))), [planned]);
  const themes = useMemo(() => [...new Set(meals.map((meal) => meal.theme))].sort(), [meals]);
  const suggestedThemes = useMemo(
    () => mergeThemeOptions(savedThemes, meals.map((meal) => meal.theme)),
    [meals, savedThemes],
  );
  const visibleMeals = useMemo(
    () => meals.filter((meal) => (theme === "All meals" || meal.theme === theme) && meal.name.toLocaleLowerCase().includes(mealSearch.trim().toLocaleLowerCase())),
    [mealSearch, meals, theme],
  );
  const visibleShopping = useMemo(() => {
    const query = shoppingSearch.trim().toLocaleLowerCase();
    return shopping.filter((item) => !query || item.ingredient.toLocaleLowerCase().includes(query) || item.meals.some((meal) => meal.toLocaleLowerCase().includes(query)));
  }, [shopping, shoppingSearch]);
  const frequentEssentials = useMemo(() => {
    return rankPantryItems(essentials.filter((item) => !pantryCheckExcludedKeys.has(canonical(item.name))), 5);
  }, [essentials, pantryCheckExcludedKeys]);

  useEffect(() => {
    const currentKeys = frequentEssentials.map((item) => canonical(item.name));
    const previousKeys = previousPantryCheckKeysRef.current;
    const enteringKey = previousKeys && currentKeys.find((key) => !previousKeys.includes(key));
    previousPantryCheckKeysRef.current = currentKeys;
    if (!enteringKey) return;
    setPantryCheckEnteringKey(enteringKey);
    if (pantryCheckEntranceTimerRef.current) window.clearTimeout(pantryCheckEntranceTimerRef.current);
    pantryCheckEntranceTimerRef.current = window.setTimeout(() => {
      setPantryCheckEnteringKey("");
      pantryCheckEntranceTimerRef.current = null;
    }, 650);
  }, [frequentEssentials]);

  useEffect(() => () => {
    pantryCheckTimersRef.current.forEach((timers) => timers.forEach((timer) => window.clearTimeout(timer)));
    if (pantryCheckEntranceTimerRef.current) window.clearTimeout(pantryCheckEntranceTimerRef.current);
  }, []);

  useEffect(() => {
    void Promise.all([api<{ meals: Meal[]; themes: string[] }>("/api/meals"), api<WeekPayload>("/api/week")])
      .then(([mealData, weekData]) => {
        setMeals(mealData.meals);
        setSavedThemes(mealData.themes);
        applyWeek(weekData);
      })
      .catch((error: Error) => setWeekMessage({ text: error.message, error: true }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const dialog = mealDialogRef.current;
    if (!dialog) return;
    if (mealDialogOpen && !dialog.open) dialog.showModal();
    if (!mealDialogOpen && dialog.open) dialog.close();
  }, [mealDialogOpen]);

  useEffect(() => {
    const dialog = addMealDialogRef.current;
    if (!dialog) return;
    if (addMealOpen && !dialog.open) dialog.showModal();
    if (!addMealOpen && dialog.open) dialog.close();
  }, [addMealOpen]);

  useEffect(() => {
    const dialog = deleteMealDialogRef.current;
    if (!dialog) return;
    if (mealPendingDelete && !dialog.open) dialog.showModal();
    if (!mealPendingDelete && dialog.open) dialog.close();
  }, [mealPendingDelete]);

  useEffect(() => {
    if (!mealDialogOpen && !addMealOpen && !mealPendingDelete) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mealDialogOpen, addMealOpen, mealPendingDelete]);

  function applyWeek(week: WeekPayload) {
    setWeekStart(week.weekStart);
    setPlanned(week.meals);
  }

  async function loadMyWeek() {
    setShoppingMessage({ text: "Loading your shopping list…" });
    try {
      const [week, list, essentialData] = await Promise.all([
        api<WeekPayload>("/api/week?refresh=1"),
        api<{ items: ShoppingItem[] }>("/api/shopping-list?refresh=1"),
        api<{ essentials: Essential[] }>("/api/essentials?refresh=1"),
      ]);
      applyWeek(week);
      setShopping(list.items);
      setPantryCheckExcludedKeys(new Set(list.items.map((item) => canonical(item.ingredient))));
      setEssentials(essentialData.essentials);
      setShoppingMessage({ text: "" });
    } catch (error) {
      setShoppingMessage({ text: (error as Error).message, error: true });
    }
  }

  async function loadPantry() {
    setPantryMessage({ text: "Loading your pantry…" });
    try {
      const [data, list] = await Promise.all([
        api<{ essentials: Essential[] }>("/api/essentials?refresh=1"),
        api<{ items: ShoppingItem[] }>("/api/shopping-list?refresh=1"),
      ]);
      setEssentials(data.essentials);
      setShopping(list.items);
      setPantryMessage({ text: "" });
    } catch (error) {
      setPantryMessage({ text: (error as Error).message, error: true });
    }
  }

  function changeView(next: "meals" | "week" | "pantry") {
    setView(next);
    if (next === "week") void loadMyWeek();
    if (next === "pantry") void loadPantry();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function addMealToWeek(meal: Meal) {
    if (plannedKeys.has(mealKey(meal.name))) return;
    const previous = planned;
    setPlanned([...planned, meal]);
    setWeekMessage({ text: "Saving to your meal history…" });
    try {
      const week = await api<WeekPayload>("/api/week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealId: meal.id }),
      });
      applyWeek(week);
      setMeals((current) => current.map((item) => item.id === meal.id ? { ...item, lastOrdered: week.weekStart } : item));
      setWeekMessage({ text: "" });
      if (view === "week") window.setTimeout(() => void loadMyWeek(), 1000);
    } catch (error) {
      setPlanned(previous);
      setWeekMessage({ text: (error as Error).message, error: true });
    }
  }

  async function removeMealFromWeek(meal: Meal) {
    const previous = planned;
    setPlanned(planned.filter((item) => mealKey(item.name) !== mealKey(meal.name)));
    setWeekMessage({ text: "Updating your meal history…" });
    try {
      const week = await api<WeekPayload>(`/api/week/${encodeURIComponent(meal.id)}`, { method: "DELETE" });
      applyWeek(week);
      setWeekMessage({ text: "" });
      void refreshOrderDates();
      if (view === "week") window.setTimeout(() => void loadMyWeek(), 1000);
    } catch (error) {
      setPlanned(previous);
      setWeekMessage({ text: (error as Error).message, error: true });
    }
  }

  async function refreshOrderDates() {
    try {
      const data = await api<{ meals: Meal[] }>("/api/meals?refresh=1");
      setMeals(data.meals);
    } catch {
      // Existing labels remain usable if this background refresh fails.
    }
  }

  function requestDeleteMeal(meal: Meal) {
    setDeleteMealError("");
    setMealPendingDelete(meal);
  }

  function closeDeleteMeal() {
    if (deletingMeal) return;
    setDeleteMealError("");
    setMealPendingDelete(null);
  }

  async function confirmDeleteMeal() {
    const meal = mealPendingDelete;
    if (!meal || deletingMeal) return;
    setDeletingMeal(true);
    setDeleteMealError("");
    setWeekMessage({ text: `Deleting ${meal.name}…` });
    try {
      await api(`/api/meals/${encodeURIComponent(meal.id)}`, { method: "DELETE" });
      setMeals((current) => current.filter((item) => item.id !== meal.id));
      setPlanned((current) => current.filter((item) => item.id !== meal.id));
      if (activeMeal?.id === meal.id) {
        setMealDialogOpen(false);
        setActiveMeal(null);
      }
      setMealPendingDelete(null);
      setWeekMessage({ text: `${meal.name} deleted.` });
    } catch (error) {
      const message = (error as Error).message;
      setDeleteMealError(message);
      setWeekMessage({ text: message, error: true });
    } finally {
      setDeletingMeal(false);
    }
  }

  async function openMeal(meal: Meal) {
    setIngredientMessage("");
    setEditIngredient(null);
    setEditingMealName(false);
    setMealNameError("");
    try {
      const data = await api<{ meal: MealDetail }>(`/api/meals/${encodeURIComponent(meal.id)}`);
      setActiveMeal(data.meal);
      setMealNameInput(data.meal.name);
      setMealThemeInput(data.meal.theme);
      setMealDialogOpen(true);
      window.setTimeout(() => ingredientInputRef.current?.focus(), 50);
    } catch (error) {
      setWeekMessage({ text: (error as Error).message, error: true });
    }
  }

  async function saveMealName(event: FormEvent) {
    event.preventDefault();
    if (!activeMeal) return;
    const name = mealNameInput.trim();
    const selectedTheme = mealThemeInput.trim();
    if (!name) return setMealNameError("Enter a meal name.");
    if (!selectedTheme) return setMealNameError("Choose a theme.");
    if (name === activeMeal.name && selectedTheme === activeMeal.theme) {
      setEditingMealName(false);
      setMealNameError("");
      return;
    }
    const previousName = activeMeal.name;
    setSavingMealName(true);
    setMealNameError("");
    try {
      const data = await api<{ meal: MealDetail }>(`/api/meals/${encodeURIComponent(activeMeal.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, theme: selectedTheme }),
      });
      setActiveMeal(data.meal);
      setMealNameInput(data.meal.name);
      setMeals((current) => current.map((meal) => meal.id === data.meal.id ? { ...meal, ...data.meal } : meal));
      setSavedThemes((current) => current.some((item) => mealKey(item) === mealKey(data.meal.theme)) ? current : [...current, data.meal.theme]);
      setPlanned((current) => current.map((meal) => meal.id === data.meal.id || mealKey(meal.name) === mealKey(previousName) ? { ...meal, ...data.meal } : meal));
      setEditingMealName(false);
      setIngredientMessage("Meal details updated.");
    } catch (error) {
      setMealNameError((error as Error).message);
    } finally {
      setSavingMealName(false);
    }
  }

  async function addIngredient(event: FormEvent) {
    event.preventDefault();
    const ingredient = ingredientInput.trim();
    if (!ingredient || !activeMeal) return;
    if (activeMeal.ingredients.some((item) => item.toLocaleLowerCase() === ingredient.toLocaleLowerCase())) {
      setIngredientMessage("That ingredient is already on this meal.");
      ingredientInputRef.current?.select();
      return;
    }
    const mealId = activeMeal.id;
    const key = `${mealId}:${ingredient.toLocaleLowerCase()}`;
    const optimistic = { ...activeMeal, ingredients: [...activeMeal.ingredients, ingredient] };
    setActiveMeal(optimistic);
    setIngredientInput("");
    setPendingIngredients((current) => new Set(current).add(key));
    setIngredientMessage("");
    requestAnimationFrame(() => {
      ingredientInputRef.current?.focus();
      ingredientFormRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    try {
      const data = await api<{ meal: MealDetail }>(`/api/meals/${encodeURIComponent(mealId)}/ingredients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: ingredient }),
      });
      setActiveMeal((current) => current?.id === mealId ? data.meal : current);
    } catch (error) {
      setActiveMeal((current) => current?.id === mealId ? { ...current, ingredients: current.ingredients.filter((item) => item !== ingredient) } : current);
      setIngredientMessage(`${ingredient} was not saved. ${(error as Error).message}`);
    } finally {
      setPendingIngredients((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function removeIngredient(index: number) {
    if (!activeMeal) return;
    try {
      const data = await api<{ meal: MealDetail }>(`/api/meals/${encodeURIComponent(activeMeal.id)}/ingredients/${index}`, { method: "DELETE" });
      setActiveMeal(data.meal);
      setIngredientMessage("Ingredient removed.");
    } catch (error) {
      setIngredientMessage((error as Error).message);
    }
  }

  async function saveIngredientEdit(event: FormEvent) {
    event.preventDefault();
    if (!activeMeal || !editIngredient) return;
    const value = editIngredient.value.trim();
    if (!value) return setIngredientMessage("Enter an ingredient.");
    try {
      const data = await api<{ meal: MealDetail }>(`/api/meals/${encodeURIComponent(activeMeal.id)}/ingredients/${editIngredient.index}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      setActiveMeal(data.meal);
      setEditIngredient(null);
      setIngredientMessage("Ingredient updated.");
    } catch (error) {
      setIngredientMessage((error as Error).message);
    }
  }

  async function submitNewMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setAddingMeal(true);
    setAddMealError("");
    try {
      const data = await api<{ meal: MealDetail; count: number }>("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newMealName, theme: newMealTheme }),
      });
      setMeals((current) => [...current, data.meal]);
      setSavedThemes((current) => current.some((item) => mealKey(item) === mealKey(data.meal.theme)) ? current : [...current, data.meal.theme]);
      setTheme("All meals");
      setAddMealOpen(false);
      formElement.reset();
      setNewMealName("");
      setNewMealTheme("");
      setActiveMeal(data.meal);
      setMealDialogOpen(true);
    } catch (error) {
      setAddMealError((error as Error).message);
    } finally {
      setAddingMeal(false);
    }
  }

  function closeAddMeal() {
    setAddMealOpen(false);
    setNewMealName("");
    setNewMealTheme("");
    setAddMealError("");
  }

  function handleAddMealDialogKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Backspace") return;
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) event.preventDefault();
  }

  function printShoppingList() {
    setShoppingSearch("");
    window.setTimeout(() => window.print(), 50);
  }

  function downloadShoppingList() {
    const bytes = buildShoppingListPdf({ weekLabel: formatWeek(weekStart), items: shopping });
    const pdfBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(pdfBuffer).set(bytes);
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `supper-shuffle-shopping-list-${weekStart || "this-week"}.pdf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function removeShoppingItem(item: ShoppingItem) {
    const previous = shopping;
    setShopping(shopping.filter((entry) => entry.id !== item.id));
    setShoppingMessage({ text: `Removing ${item.ingredient}…` });
    try {
      await api(`/api/shopping-list/${encodeURIComponent(item.ingredient)}`, { method: "DELETE" });
      const key = canonical(item.ingredient);
      pantryCheckTimersRef.current.get(key)?.forEach((timer) => window.clearTimeout(timer));
      pantryCheckTimersRef.current.delete(key);
      setPantryCheckLeavingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setPantryCheckExcludedKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      if (!item.meals.length) setEssentials((current) => current.map((essential) => canonical(essential.name) === canonical(item.ingredient) ? { ...essential, orderCount: Math.max(0, (essential.orderCount || 0) - 1) } : essential));
      setShoppingMessage({ text: "Removed from this week's shopping list." });
    } catch (error) {
      setShopping(previous);
      setShoppingMessage({ text: (error as Error).message, error: true });
    }
  }

  async function addEssential(essential: Essential) {
    if (shopping.some((item) => canonical(item.ingredient) === canonical(essential.name))) return;
    const setMessage = view === "pantry" ? setPantryMessage : setShoppingMessage;
    const item: ShoppingItem = { id: canonical(essential.name), ingredient: essential.name, quantity: essential.defaultQuantity || "1", meals: [] };
    setShopping((current) => [...current, item].sort((left, right) => left.ingredient.localeCompare(right.ingredient)));
    setMessage({ text: `Adding ${essential.name}…` });
    try {
      await api(`/api/shopping-list/${encodeURIComponent(essential.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: item.quantity }),
      });
      if (view === "week") schedulePantryCheckExit(essential.name);
      else incrementEssentialOrderCount(essential.name);
      setMessage({ text: `${essential.name} added to this week's list.` });
    } catch (error) {
      cancelPantryCheckExit(essential.name);
      setShopping((current) => current.filter((entry) => entry.id !== item.id));
      setMessage({ text: (error as Error).message, error: true });
    }
  }

  function schedulePantryCheckExit(name: string) {
    const key = canonical(name);
    cancelPantryCheckExit(name);
    const leaveTimer = window.setTimeout(() => {
      setPantryCheckLeavingKeys((current) => new Set(current).add(key));
    }, 1200);
    const replaceTimer = window.setTimeout(() => {
      setPantryCheckExcludedKeys((current) => new Set(current).add(key));
      incrementEssentialOrderCount(name);
      setPantryCheckLeavingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      pantryCheckTimersRef.current.delete(key);
    }, 1650);
    pantryCheckTimersRef.current.set(key, [leaveTimer, replaceTimer]);
  }

  function incrementEssentialOrderCount(name: string) {
    setEssentials((current) => current.map((item) => canonical(item.name) === canonical(name) ? { ...item, orderCount: (item.orderCount || 0) + 1 } : item));
  }

  function cancelPantryCheckExit(name: string) {
    const key = canonical(name);
    pantryCheckTimersRef.current.get(key)?.forEach((timer) => window.clearTimeout(timer));
    pantryCheckTimersRef.current.delete(key);
    setPantryCheckExcludedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setPantryCheckLeavingKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  async function createEssential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addingEssential) return;
    const name = newEssentialName.trim();
    if (!name) {
      setPantryMessage({ text: "A pantry item needs a name.", error: true });
      return;
    }
    if (essentials.some((item) => canonical(item.name) === canonical(name))) {
      setPantryMessage({ text: "That pantry item already exists.", error: true });
      return;
    }
    setAddingEssential(true);
    setPantryMessage({ text: `Adding ${name}…` });
    try {
      const result = await api<{ essential: Essential }>("/api/essentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setEssentials((current) => [...current, result.essential].sort((left, right) => left.name.localeCompare(right.name)));
      setNewEssentialName("");
      setPantryMessage({ text: `${name} added to your pantry.` });
    } catch (error) {
      setPantryMessage({ text: (error as Error).message, error: true });
    } finally {
      setAddingEssential(false);
    }
  }

  async function removeEssential(essential: Essential) {
    const previous = essentials;
    setEssentials((current) => current.filter((item) => canonical(item.name) !== canonical(essential.name)));
    setPantryMessage({ text: `Removing ${essential.name}…` });
    try {
      await api(`/api/essentials/${encodeURIComponent(essential.name)}`, { method: "DELETE" });
      setPantryMessage({ text: `${essential.name} removed from your pantry.` });
    } catch (error) {
      setEssentials(previous);
      setPantryMessage({ text: (error as Error).message, error: true });
    }
  }

  return (
    <div className="app-root">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => changeView("meals")} aria-label="Supper Shuffle home"><span className="brand-mark">S</span><span>Supper Shuffle</span></button>
        <nav aria-label="Primary navigation">
          <button className={view === "meals" ? "active" : ""} onClick={() => changeView("meals")}>Meals</button>
          <button className={view === "week" ? "active" : ""} onClick={() => changeView("week")}>My week</button>
          <button className={view === "pantry" ? "active" : ""} onClick={() => changeView("pantry")}>My Pantry</button>
        </nav>
      </header>

      {view === "meals" ? (
        <main>
          <section className="hero">
            <div><h1>What sounds good<br />this week?</h1><p className="hero-copy">Pick a few favorites, build your week, and let dinner stop being a daily decision.</p></div>
            <div className="week-card">
              <div className="week-card-heading"><div><span>THIS WEEK</span><strong>{planned.length ? `${planned.length} dinner${planned.length === 1 ? "" : "s"} planned` : "Ready when you are"}</strong></div><span className="progress">{planned.length}</span></div>
              <div className="week-list" aria-live="polite">
                {planned.length ? planned.map((meal) => <div className="week-item" key={mealKey(meal.name)}><p>{meal.name}</p><button onClick={() => void removeMealFromWeek(meal)} aria-label={`Remove ${meal.name}`}>×</button></div>) : <div className="week-empty"><strong>No dinners planned yet</strong><span>Add one from your meal library below.</span></div>}
              </div>
              <p className={`week-message ${weekMessage.error ? "error" : ""}`} role="status">{weekMessage.text}</p>
              <button type="button" className="plan-button" onClick={() => changeView("week")}>View my week &amp; shopping list <span aria-hidden="true">→</span></button>
            </div>
          </section>

          <section className="library">
            <div className="library-heading"><div><p className="eyebrow">{loading ? "LOADING RECIPES" : `${meals.length} RECIPES`}</p><h2>Find a meal</h2></div><div className="library-actions"><button className="add-meal-button" onClick={() => { setAddMealError(""); setNewMealName(""); setNewMealTheme(""); setAddMealOpen(true); }}>+ Create Meal</button><label className="search"><span aria-hidden="true">⌕</span><input value={mealSearch} onChange={(event) => setMealSearch(event.target.value)} placeholder="Search your meals…" aria-label="Search meals" /></label></div></div>
            <div className="filters" aria-label="Filter meals by theme"><button className={theme === "All meals" ? "selected" : ""} onClick={() => setTheme("All meals")}>All meals</button>{themes.map((item) => <button className={theme === item ? "selected" : ""} onClick={() => setTheme(item)} key={item}>{item}</button>)}</div>
            <div className="meal-grid" aria-live="polite">
              {visibleMeals.map((meal, index) => {
                const added = plannedKeys.has(mealKey(meal.name));
                return <article className={`meal-card color-${index % 5}`} key={meal.id} tabIndex={0} role="button" aria-label={`View ingredients for ${meal.name}`} onClick={() => void openMeal(meal)} onKeyDown={(event) => handleCardKey(event, () => void openMeal(meal))}><div className="meal-art" aria-hidden="true"><span>{emojiByTheme[meal.theme] || "🍽️"}</span></div><div className="meal-info"><p>{meal.theme}</p><h3>{meal.name}</h3><button className={added ? "added" : ""} onClick={(event) => { event.stopPropagation(); void (added ? removeMealFromWeek(meal) : addMealToWeek(meal)); }}>{added ? "✓ On this week" : "+ Add to week"}</button>{meal.lastOrdered && <span className="last-ordered">Last Ordered: <strong>{meal.lastOrdered}</strong></span>}<div className="meal-card-footer"><span className="view-recipe">View ingredients →</span><button type="button" className="meal-delete-button" onClick={(event) => { event.stopPropagation(); requestDeleteMeal(meal); }} aria-label={`Delete ${meal.name}`}>Delete</button></div></div></article>;
              })}
              {!visibleMeals.length && <p className="no-results">No dinners found. Try another search.</p>}
            </div>
          </section>
        </main>
      ) : view === "week" ? (
        <main className="my-week-page">
          <div className="my-week-heading"><h1>My week</h1><p className="my-week-heading-date">Week of {formatWeek(weekStart)}</p><button className="back-to-meals" onClick={() => changeView("meals")}>← Go back to add more meals</button></div>
          <div className="my-week-layout">
            <aside className="planned-panel"><div className="panel-heading"><div><p className="eyebrow">DINNERS</p><h2>On the menu</h2></div><span>{planned.length}</span></div><div className="planned-meal-list">{planned.length ? planned.map((meal, index) => <div className="planned-meal" key={mealKey(meal.name)}><span>{index + 1}</span><div><p>{meal.theme}</p><strong>{meal.name}</strong></div><button onClick={() => void removeMealFromWeek(meal)} aria-label={`Remove ${meal.name}`}>×</button></div>) : <div className="week-page-empty"><strong>No meals selected yet</strong><span>Head back to Meals to start planning.</span></div>}</div></aside>
            <section className="shopping-panel"><div className="panel-heading"><div><p className="eyebrow">SHOPPING LIST</p><h2>Everything you need</h2><p className="shopping-count-copy">{shopping.length} {shopping.length === 1 ? "item" : "items"} in cart</p></div><div className="shopping-heading-actions"><button className="shopping-icon-button print-button" onClick={printShoppingList} aria-label="Print shopping list" title="Print shopping list"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z" /></svg></button><button className="shopping-icon-button download-button" onClick={downloadShoppingList} aria-label="Download shopping list as PDF" title="Download PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M4 20h16" /></svg></button></div></div><div className="pantry-check"><div className="pantry-check-heading"><div><p className="eyebrow">PANTRY CHECK</p><p>Running low on something you usually keep around?</p></div><button type="button" className="pantry-manage-link" onClick={() => changeView("pantry")}>Go to My Pantry →</button></div><div className="pantry-quick-list" aria-live="polite">{frequentEssentials.length ? frequentEssentials.map((essential) => { const key = canonical(essential.name); const added = shopping.some((item) => canonical(item.ingredient) === key); const motionClass = pantryCheckLeavingKeys.has(key) ? " is-leaving" : pantryCheckEnteringKey === key ? " is-entering" : ""; return <div className={`pantry-quick-item${motionClass}`} key={essential.name}><span>{essential.name}</span><button type="button" className={added ? "added" : ""} disabled={added} onClick={() => void addEssential(essential)}>{added ? "On list" : "+ Add to list"}</button></div>; }) : <span className="pantry-quick-empty">Everything in your pantry is already on this week's list.</span>}</div></div><label className="shopping-search"><span aria-hidden="true">⌕</span><input type="search" value={shoppingSearch} onChange={(event) => setShoppingSearch(event.target.value)} placeholder="Search ingredients or meals…" aria-label="Search shopping list by ingredient or meal" /></label><div className="shopping-list" aria-live="polite">{visibleShopping.length ? visibleShopping.map((item) => <div className="shopping-item" key={item.id}><div className="shopping-copy"><strong>{item.ingredient}</strong><span>{item.meals.length ? item.meals.join(", ") : "Pantry essential"}</span></div><div className="shopping-quantity" aria-label={`Quantity ${item.quantity}`}><span>QTY</span><strong>{item.quantity}</strong></div><button onClick={() => void removeShoppingItem(item)}>Remove</button></div>) : <div className="week-page-empty shopping-empty"><strong>{shoppingSearch ? "No matches found" : "Your shopping list is empty"}</strong><span>{shoppingSearch ? "Try an ingredient or one of your meal names." : "Add a meal to automatically gather its ingredients."}</span></div>}</div><p className={`shopping-message ${shoppingMessage.error ? "error" : ""}`} role="status">{shoppingMessage.text}</p></section>
          </div>
        </main>
      ) : (
        <main className="pantry-page">
          <section className="pantry-hero">
            <div><p className="eyebrow">PANTRY STAPLES</p><h1>My Pantry</h1><p>Keep the things you usually have on hand here, then quickly add them to a weekly shopping list whenever supplies run low.</p></div>
            <form className="pantry-add-form pantry-page-add" onSubmit={(event) => void createEssential(event)}><input value={newEssentialName} onChange={(event) => setNewEssentialName(event.target.value)} placeholder="e.g. Flour" aria-label="New pantry item" maxLength={80} /><button type="submit" disabled={addingEssential}>{addingEssential ? "Adding…" : "+ Add pantry item"}</button></form>
          </section>
          <section className="pantry-library">
            <div className="pantry-library-heading"><div><p className="eyebrow">YOUR STAPLES</p><h2>Things you keep around</h2></div><span>{essentials.length}</span></div>
            <div className="pantry-grid" aria-live="polite">{essentials.length ? essentials.map((essential) => { const added = shopping.some((item) => canonical(item.ingredient) === canonical(essential.name)); return <article className="pantry-card" key={essential.name}><strong>{essential.name}</strong><div className="pantry-card-actions"><button type="button" className={added ? "added" : ""} disabled={added} onClick={() => void addEssential(essential)}>{added ? "On this week's list" : "+ Add to this week's list"}</button><button type="button" className="pantry-card-remove" onClick={() => void removeEssential(essential)}>Remove from pantry</button></div></article>; }) : <div className="pantry-empty"><strong>Your pantry is empty</strong><span>Add a staple above to get started.</span></div>}</div>
            <p className={`pantry-message ${pantryMessage.error ? "error" : ""}`} role="status">{pantryMessage.text}</p>
          </section>
        </main>
      )}

      <dialog ref={addMealDialogRef} className="meal-dialog add-meal-dialog" onClose={closeAddMeal} onKeyDown={handleAddMealDialogKeyDown} onPointerDown={(event) => { addMealBackdropPressRef.current = event.target === event.currentTarget; }} onClick={(event) => { const closeFromBackdrop = shouldCloseFromBackdrop(event.target === event.currentTarget, addMealBackdropPressRef.current); addMealBackdropPressRef.current = false; if (closeFromBackdrop) closeAddMeal(); }}><div className="dialog-topline"><div><p className="eyebrow">NEW RECIPE</p><h2>Add a meal</h2></div><button className="dialog-close" onClick={closeAddMeal} aria-label="Close add meal dialog">×</button></div><form className="add-meal-form" onSubmit={(event) => void submitNewMeal(event)} autoComplete="off"><label>Meal name<input name="meal-title" value={newMealName} onChange={(event) => setNewMealName(event.target.value)} maxLength={100} placeholder="e.g. Lemon Chicken" autoComplete="off" autoCorrect="off" spellCheck={false} required autoFocus /></label><ThemeCombobox name="theme" value={newMealTheme} onChange={setNewMealTheme} options={suggestedThemes} /><p className="add-meal-error" role="alert">{addMealError}</p><button className="add-meal-submit" type="submit" disabled={addingMeal}>{addingMeal ? "Saving…" : "Save meal"}</button></form></dialog>

      <dialog ref={deleteMealDialogRef} className="meal-dialog confirm-dialog" aria-labelledby="delete-meal-title" onCancel={(event) => { event.preventDefault(); closeDeleteMeal(); }} onClose={() => { if (!deletingMeal) setMealPendingDelete(null); }} onPointerDown={(event) => { deleteMealBackdropPressRef.current = event.target === event.currentTarget; }} onClick={(event) => { const closeFromBackdrop = shouldCloseFromBackdrop(event.target === event.currentTarget, deleteMealBackdropPressRef.current); deleteMealBackdropPressRef.current = false; if (closeFromBackdrop) closeDeleteMeal(); }}>{mealPendingDelete && <div className="confirm-dialog-content"><span className="confirm-dialog-mark" aria-hidden="true">!</span><p className="eyebrow">DELETE MEAL</p><h2 id="delete-meal-title">Are you sure?</h2><p className="confirm-dialog-copy"><strong>{mealPendingDelete.name}</strong> and all of its ingredients and meal history will be permanently removed.</p><p className="confirm-dialog-error" role="alert">{deleteMealError}</p><div className="confirm-dialog-actions"><button type="button" className="confirm-cancel" onClick={closeDeleteMeal} disabled={deletingMeal}>Keep meal</button><button type="button" className="confirm-delete" onClick={() => void confirmDeleteMeal()} disabled={deletingMeal}>{deletingMeal ? "Deleting…" : "Delete meal"}</button></div></div>}</dialog>

      <dialog ref={mealDialogRef} className="meal-dialog" onClose={() => setMealDialogOpen(false)} onPointerDown={(event) => { mealBackdropPressRef.current = event.target === event.currentTarget; }} onClick={(event) => { const closeFromBackdrop = shouldCloseFromBackdrop(event.target === event.currentTarget, mealBackdropPressRef.current); mealBackdropPressRef.current = false; if (closeFromBackdrop) setMealDialogOpen(false); }}>{activeMeal && <><div className="dialog-topline"><div className="dialog-title-block">{editingMealName ? <form className="meal-name-form" onSubmit={(event) => void saveMealName(event)} autoComplete="off"><input value={mealNameInput} onChange={(event) => setMealNameInput(event.target.value)} maxLength={100} aria-label="Meal name" autoComplete="off" autoCorrect="off" spellCheck={false} autoFocus /><ThemeCombobox compact value={mealThemeInput} onChange={setMealThemeInput} options={suggestedThemes} /><div className="meal-name-actions"><button type="submit" disabled={savingMealName}>{savingMealName ? "Saving…" : "Save changes"}</button><button type="button" disabled={savingMealName} onClick={() => { setMealNameInput(activeMeal.name); setMealThemeInput(activeMeal.theme); setMealNameError(""); setEditingMealName(false); }}>Cancel</button></div><p className="meal-name-error" role="alert">{mealNameError}</p></form> : <><p className="eyebrow">{activeMeal.theme}</p><div className="editable-meal-title"><h2>{activeMeal.name}</h2><button className="edit-meal-name" onClick={() => { setMealNameInput(activeMeal.name); setMealThemeInput(activeMeal.theme); setMealNameError(""); setEditingMealName(true); }}>Edit meal</button></div></>}</div><button className="dialog-close" onClick={() => setMealDialogOpen(false)} aria-label="Close meal details">×</button></div><button className={`dialog-week-button ${plannedKeys.has(mealKey(activeMeal.name)) ? "added" : ""}`} onClick={() => void (plannedKeys.has(mealKey(activeMeal.name)) ? removeMealFromWeek(activeMeal) : addMealToWeek(activeMeal))}>{plannedKeys.has(mealKey(activeMeal.name)) ? "✓ On This Week — Remove" : "+ Add to This Week"}</button><p className="dialog-intro">Ingredients</p><ul className="ingredient-list">{activeMeal.ingredients.length ? activeMeal.ingredients.map((ingredient, index) => { const pending = pendingIngredients.has(`${activeMeal.id}:${ingredient.toLocaleLowerCase()}`); return <li key={`${ingredient}-${index}`}>{editIngredient?.index === index ? <form className="ingredient-inline-form" onSubmit={(event) => void saveIngredientEdit(event)}><input className="ingredient-edit-input" value={editIngredient.value} onChange={(event) => setEditIngredient({ index, value: event.target.value })} maxLength={80} autoFocus /><div className="ingredient-actions"><button type="submit">Save</button><button type="button" onClick={() => setEditIngredient(null)}>Cancel</button></div></form> : <><span>{ingredient}</span>{pending ? <span className="ingredient-saving">Saving…</span> : <div className="ingredient-actions"><button onClick={() => setEditIngredient({ index, value: ingredient })}>Edit</button><button onClick={() => void removeIngredient(index)}>Remove</button></div>}</>}</li>; }) : <li className="empty-ingredients">No ingredients yet.</li>}</ul><form ref={ingredientFormRef} className="ingredient-form" onSubmit={(event) => void addIngredient(event)}><input ref={ingredientInputRef} value={ingredientInput} onChange={(event) => setIngredientInput(event.target.value)} maxLength={80} placeholder="Add an ingredient…" aria-label="New ingredient" required /><button type="submit">Add</button></form><p className="ingredient-message" role="status">{ingredientMessage}</p></>}</dialog>
    </div>
  );
}

function canonical(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function handleCardKey(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}
