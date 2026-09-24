import { getDesignPaletteTheme } from "@hraness/design-kit";

export const ohDefaultAppearance = { palette: "gruvbox", mode: "system" } as const;
export const ohInitialTheme = getDesignPaletteTheme(ohDefaultAppearance.palette, "light");
