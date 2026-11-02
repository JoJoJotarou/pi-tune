import { readFileSync } from "node:fs";
import { Theme } from "@earendil-works/pi-coding-agent";

type ThemeColors = ConstructorParameters<typeof Theme>[0] & ConstructorParameters<typeof Theme>[1];

/** Pi's built-in theme as a real `Theme`, for unit tests (Pi only hands themes to render callbacks). */
export function testTheme(name: "dark" | "light" = "dark"): Theme {
  const url = new URL(`./modes/interactive/theme/${name}.json`, import.meta.resolve("@earendil-works/pi-coding-agent"));
  const json = JSON.parse(readFileSync(url, "utf8")) as {
    vars: Record<string, string>;
    colors: Record<string, string>;
  };
  const colors = Object.fromEntries(
    Object.entries(json.colors).map(([token, value]) => [token, json.vars[value] ?? value]),
  ) as ThemeColors;
  return new Theme(colors, colors, "truecolor", { name });
}
