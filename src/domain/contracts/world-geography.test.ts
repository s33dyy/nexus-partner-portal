import { describe, expect, test } from "bun:test";

import { resolveCountryForText, WORLD_COUNTRIES } from "./world-geography";

describe("resolveCountryForText", () => {
  test("resolves exact country names", () => {
    expect(resolveCountryForText("India")?.code).toBe("IN");
    expect(resolveCountryForText("Singapore")?.code).toBe("SG");
    expect(resolveCountryForText("United States")?.code).toBe("US");
  });

  test("is case- and whitespace-insensitive", () => {
    expect(resolveCountryForText("  india  ")?.code).toBe("IN");
    expect(resolveCountryForText("INDIA")?.code).toBe("IN");
  });

  test("resolves an ISO alpha-2 code directly", () => {
    expect(resolveCountryForText("IN")?.code).toBe("IN");
    expect(resolveCountryForText("sg")?.code).toBe("SG");
  });

  test("resolves common aliases", () => {
    expect(resolveCountryForText("USA")?.code).toBe("US");
    expect(resolveCountryForText("UK")?.code).toBe("GB");
    expect(resolveCountryForText("UAE")?.code).toBe("AE");
  });

  test("returns null for empty or unmatched text", () => {
    expect(resolveCountryForText(null)).toBeNull();
    expect(resolveCountryForText(undefined)).toBeNull();
    expect(resolveCountryForText("")).toBeNull();
    expect(resolveCountryForText("Not A Real Country")).toBeNull();
  });

  test("every world country resolves to itself by name", () => {
    for (const country of WORLD_COUNTRIES) {
      expect(resolveCountryForText(country.name)?.code).toBe(country.code);
    }
  });
});
