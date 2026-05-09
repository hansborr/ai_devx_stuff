import { cellToPixel } from "@musi/shared/map";
import { vi } from "vitest";

vi.mock("@musi/shared/map", async () => {
  const actual = await vi.importActual("@musi/shared/map");
  return actual;
});

export const pixel = cellToPixel(2, 50);
