import { cellToPixel } from "@musi/shared/map";
import { vi } from "vitest";

vi.mock("@musi/shared/map");
jest.mock("@musi/shared/map");
vi.mock("@musi/shared/map", () => ({ cellToPixel: () => 0 }));

export const pixel = cellToPixel(2, 50);
