import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCliArgs } from "../bin/cli.js";

const DEFAULT_OPTIONS = { port: undefined, host: undefined, open: true, secContact: undefined };

describe("parseCliArgs", () => {
  it("returns default options when no flags are given", () => {
    assert.deepEqual(parseCliArgs([]), { options: DEFAULT_OPTIONS });
  });

  it("parses --port <n>", () => {
    assert.deepEqual(parseCliArgs(["--port", "4000"]), {
      options: { ...DEFAULT_OPTIONS, port: 4000 },
    });
  });

  it("parses --port=<n>", () => {
    assert.deepEqual(parseCliArgs(["--port=4000"]), {
      options: { ...DEFAULT_OPTIONS, port: 4000 },
    });
  });

  it("parses --host", () => {
    assert.deepEqual(parseCliArgs(["--host", "0.0.0.0"]), {
      options: { ...DEFAULT_OPTIONS, host: "0.0.0.0" },
    });
  });

  it("parses --no-open", () => {
    assert.deepEqual(parseCliArgs(["--no-open"]), {
      options: { ...DEFAULT_OPTIONS, open: false },
    });
  });

  it("parses --sec-contact", () => {
    assert.deepEqual(parseCliArgs(["--sec-contact", "me@example.com"]), {
      options: { ...DEFAULT_OPTIONS, secContact: "me@example.com" },
    });
  });

  it("combines several flags", () => {
    assert.deepEqual(parseCliArgs(["--port=8080", "--host", "0.0.0.0", "--no-open"]), {
      options: { port: 8080, host: "0.0.0.0", open: false, secContact: undefined },
    });
  });

  it("rejects a non-numeric port", () => {
    assert.ok(parseCliArgs(["--port", "abc"]).error);
  });

  it("rejects out-of-range ports", () => {
    assert.ok(parseCliArgs(["--port", "0"]).error);
    assert.ok(parseCliArgs(["--port", "70000"]).error);
  });

  it("rejects an empty --host", () => {
    assert.ok(parseCliArgs(["--host", "  "]).error);
  });

  it("rejects unknown flags", () => {
    assert.ok(parseCliArgs(["--bogus"]).error);
  });

  it("rejects stray positional arguments", () => {
    assert.ok(parseCliArgs(["extra"]).error);
  });

  it("returns help for --help and -h", () => {
    assert.deepEqual(parseCliArgs(["--help"]), { help: true });
    assert.deepEqual(parseCliArgs(["-h"]), { help: true });
  });

  it("returns the package version for --version and -v", () => {
    const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.deepEqual(parseCliArgs(["--version"]), { version });
    assert.deepEqual(parseCliArgs(["-v"]), { version });
  });
});
