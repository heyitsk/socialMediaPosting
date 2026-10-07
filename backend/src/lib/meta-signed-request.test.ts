import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { parseSignedRequest } from "./meta-signed-request";

const SECRET = "app-secret";

function sign(payload: object, secret = SECRET) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
}

describe("parseSignedRequest", () => {
  test("returns the user id of a correctly signed request", () => {
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "1234" }), SECRET)).toBe(
      "1234",
    );
  });

  test("accepts a numeric user id and a payload without an algorithm", () => {
    expect(parseSignedRequest(sign({ user_id: 99 }), SECRET)).toBe("99");
  });

  test("rejects a request signed with another secret", () => {
    expect(parseSignedRequest(sign({ user_id: "1" }, "other"), SECRET)).toBeNull();
  });

  test("rejects a tampered payload", () => {
    const [signature] = sign({ user_id: "1" }).split(".");
    const forged = Buffer.from(JSON.stringify({ user_id: "2" })).toString("base64url");
    expect(parseSignedRequest(`${signature}.${forged}`, SECRET)).toBeNull();
  });

  test("rejects another algorithm, a missing user id and malformed input", () => {
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA1", user_id: "1" }), SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256" }), SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ user_id: "" }), SECRET)).toBeNull();
    expect(parseSignedRequest("no-dot", SECRET)).toBeNull();
    expect(parseSignedRequest("a.b.c", SECRET)).toBeNull();
    expect(parseSignedRequest("", SECRET)).toBeNull();
  });

  test("rejects a validly signed payload that isn't JSON", () => {
    const encoded = Buffer.from("not json").toString("base64url");
    const signature = createHmac("sha256", SECRET).update(encoded).digest("base64url");
    expect(parseSignedRequest(`${signature}.${encoded}`, SECRET)).toBeNull();
  });
});
