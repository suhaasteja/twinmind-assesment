import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Reset DOM and mocks between tests.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does not implement scrollTo; stub it so auto-scroll effects don't throw.
if (typeof window !== "undefined") {
  Element.prototype.scrollTo = Element.prototype.scrollTo || (() => {});
}
