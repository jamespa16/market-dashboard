import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/server.js";

let server;
let port;

// Raw request so paths like "/../package.json" are sent unnormalized (fetch() would normalize them).
function rawRequest({ method = "GET", path }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  server = createServer({ log: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("static file serving", () => {
  it("serves index.html for /", async () => {
    const res = await rawRequest({ path: "/" });
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /^text\/html/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
  });

  it("strips the query string before resolving the file", async () => {
    const res = await rawRequest({ path: "/style.css?v=1" });
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /^text\/css/);
  });

  it("never serves files outside public/ for raw traversal paths", async () => {
    const plain = await rawRequest({ path: "/../package.json" });
    assert.notEqual(plain.status, 200);
    assert.ok([403, 404].includes(plain.status));

    const encoded = await rawRequest({ path: "/%2e%2e/package.json" });
    assert.notEqual(encoded.status, 200);
    assert.ok([403, 404].includes(encoded.status));
  });

  it("returns 400 for malformed percent-encoding", async () => {
    const res = await rawRequest({ path: "/%E0%A4%A" });
    assert.equal(res.status, 400);
  });

  it("returns 400 for null bytes in the path", async () => {
    const res = await rawRequest({ path: "/style.css%00.js" });
    assert.equal(res.status, 400);
  });

  it("returns 405 with Allow for POST", async () => {
    const res = await rawRequest({ method: "POST", path: "/" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, "GET, HEAD");
  });

  it("returns headers but no body for HEAD", async () => {
    const res = await rawRequest({ method: "HEAD", path: "/" });
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /^text\/html/);
    assert.equal(res.body, "");
  });

  it("returns 404 for a missing file", async () => {
    const res = await rawRequest({ path: "/nope.js" });
    assert.equal(res.status, 404);
  });
});
