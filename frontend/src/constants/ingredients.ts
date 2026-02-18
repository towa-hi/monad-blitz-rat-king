/** The six available pizza ingredients, in selection order. */
export const INGREDIENTS = ["Dough", "Sauce", "Cheese", "Pepperoni", "Basil", "Anchovy"] as const;

/** A single ingredient name. */
export type Ingredient = (typeof INGREDIENTS)[number];

/** Color mapping for each ingredient. */
export const INGREDIENT_COLORS: Record<Ingredient, string> = {
  Dough: "#d4a867",
  Sauce: "#c0392b",
  Cheese: "#f5c542",
  Pepperoni: "#d6452e",
  Basil: "#2e7d32",
  Anchovy: "#6b8fa3",
};

/** Dummy recipe distribution for the King's Recipe stacked bar. */
export const KINGS_RECIPE: { ingredient: Ingredient; percent: number }[] = [
  { ingredient: "Dough", percent: 25 },
  { ingredient: "Sauce", percent: 20 },
  { ingredient: "Cheese", percent: 20 },
  { ingredient: "Pepperoni", percent: 15 },
  { ingredient: "Basil", percent: 10 },
  { ingredient: "Anchovy", percent: 10 },
];
