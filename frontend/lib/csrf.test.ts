import { describe, it, expect } from "vitest";
import { parseCsrf } from "./csrf";

describe("parseCsrf", () => {
  it("extracts the csrftoken value from a cookie string", () => {
    expect(parseCsrf("a=1; csrftoken=abc123; b=2")).toBe("abc123");
    expect(parseCsrf("csrftoken=xyz")).toBe("xyz");
  });

  it("url-decodes the value", () => {
    expect(parseCsrf("csrftoken=a%20b")).toBe("a b");
  });

  it("does not match a lookalike cookie name", () => {
    expect(parseCsrf("xcsrftoken=nope")).toBe("");
    expect(parseCsrf("mycsrftoken=nope")).toBe("");
  });

  it("returns empty string when absent", () => {
    expect(parseCsrf("foo=bar")).toBe("");
    expect(parseCsrf("")).toBe("");
  });
});
