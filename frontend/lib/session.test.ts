import { describe, it, expect } from "vitest";
import { decodeClaims } from "./session";

function tokenFor(payload: object): string {
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${b64}.signature`;
}

describe("decodeClaims", () => {
  it("extracts user and exp from the payload segment", () => {
    const claims = decodeClaims(tokenFor({ user: "admin", exp: 1781710132 }));
    expect(claims.user).toBe("admin");
    expect(claims.exp).toBe(1781710132);
  });

  it("returns an empty object for a malformed token", () => {
    expect(decodeClaims("not-a-jwt")).toEqual({});
    expect(decodeClaims("")).toEqual({});
    expect(decodeClaims("a.!!!notbase64!!!.c")).toEqual({});
  });

  it("tolerates a payload missing user/exp", () => {
    expect(decodeClaims(tokenFor({ foo: "bar" }))).toEqual({ foo: "bar" });
  });
});
