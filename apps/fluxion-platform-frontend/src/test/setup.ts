import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// RTL leaves mounted trees between tests; unmount after each so queries on the
// document don't bleed across cases.
afterEach(() => {
  cleanup();
});
