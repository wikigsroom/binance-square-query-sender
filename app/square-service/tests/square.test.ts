import test from "node:test";
import assert from "node:assert/strict";
import { Square } from "../src/square.js";
import { errorInfo } from "../src/core.js";
import type { Http } from "../src/http.js";

test("Square credential rejections redact echoed credentials in errors and raw responses", async () => {
  const key = "fixture-square-redaction-key";
  const http = {
    request: async () => ({
      json: () => ({
        code: "AUTH",
        message: `invalid api key ${key}`,
        data: { echo: key },
      }),
    }),
  } as unknown as Http;
  await assert.rejects(
    () =>
      new Square(http).publish(key, "fixture body", [
        "https://example.invalid/image.png",
      ]),
    (e) => {
      const error = e as any;
      assert.equal(error.code, "ACCOUNT_CREDENTIAL_INVALID");
      assert.equal(error.details.definitelyRejected, true);
      assert.ok(!JSON.stringify(errorInfo(error)).includes(key));
      return true;
    },
  );
});
test("Square success without a post ID remains an unknown outcome", async () => {
  const key = "fixture-square-redaction-key";
  const http = {
    request: async () => ({
      json: () => ({ code: "000000", data: { echo: key } }),
    }),
  } as unknown as Http;
  await assert.rejects(
    () => new Square(http).publish(key, "fixture body", []),
    (e) => {
      const error = e as any;
      assert.equal(error.code, "PUBLISH_RESULT_UNKNOWN");
      assert.ok(!error.details.definitelyRejected);
      assert.ok(!JSON.stringify(errorInfo(error)).includes(key));
      return true;
    },
  );
});
test("Square confirmed response retains the receipt and sends the exact final text once", async () => {
  const key = "fixture-square-redaction-key",
    text = "已由测试模型生成的完整正文\n$AAA +1.00%";
  let calls = 0;
  const http = {
    request: async (url: string, options: any) => {
      calls++;
      assert.ok(url.endsWith("/v1/public/pgc/openApi/content/add"));
      const body = JSON.parse(options.body);
      assert.equal(body.bodyTextOnly, text);
      assert.deepEqual(body.imageList, ["https://example.invalid/image.png"]);
      return {
        json: () => ({ code: "000000", data: { id: "123456", echo: key } }),
      };
    },
  } as unknown as Http;
  const receipt = await new Square(http).publish(key, text, [
    "https://example.invalid/image.png",
  ]);
  assert.equal(calls, 1);
  assert.equal(receipt.id, "123456");
  assert.ok(!JSON.stringify(receipt).includes(key));
});
