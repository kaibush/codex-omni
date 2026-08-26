import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.js";

describe("parseCliArgs", () => {
  it("defaults to start", () => {
    expect(parseCliArgs(["node", "cli"])).toEqual({ kind: "start", options: {} });
  });

  it("parses start flags", () => {
    expect(
      parseCliArgs([
        "node",
        "cli",
        "start",
        "--host",
        "127.0.0.1",
        "--port",
        "9000",
        "--data",
        "./data/app.db"
      ])
    ).toEqual({
      kind: "start",
      options: { host: "127.0.0.1", port: "9000", data: "./data/app.db" }
    });
  });

  it("parses user create", () => {
    expect(
      parseCliArgs(["node", "cli", "user", "create", "--username", "admin", "--password", "12345678"])
    ).toEqual({ kind: "user-create", username: "admin", password: "12345678" });
  });

  it("rejects short passwords", () => {
    const result = parseCliArgs([
      "node",
      "cli",
      "user",
      "create",
      "--username",
      "admin",
      "--password",
      "short"
    ]);
    expect(result.kind).toBe("error");
  });
});
