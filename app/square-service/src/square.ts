import { Http } from "./http.js";
import {
  Fault,
  Doc,
  Row,
  requireThat,
  now,
  normalize,
  redact,
} from "./core.js";

export interface SquarePort {
  upload(key: string, bytes: Buffer, asset: Row): Promise<string>;
  publish(key: string, text: string, images: string[]): Promise<Doc>;
  verify(remoteId: string): Promise<Doc>;
}
export class Square implements SquarePort {
  constructor(private http: Http) {}
  async api(path: string, key: string, body: Doc, version = "v2") {
    const response = await this.http.request(
      `https://www.binance.com/bapi/composite/${version}/public/pgc/openApi${path}`,
      {
        method: "POST",
        headers: {
          "X-Square-OpenAPI-Key": key,
          "Content-Type": "application/json",
          clienttype: "binanceSkill",
        },
        body: JSON.stringify(body),
      },
      { allowedHosts: ["www.binance.com"], secrets: [key], timeoutMs: 90000 },
    );
    const result = response.json();
    if (result.code !== "000000") {
      const message = String(result.message || "远端拒绝请求"),
        auth = /api.?key|auth|permission|unauthori|认证|权限/i.test(message),
        limited = /rate|limit|quota|频率|限流/i.test(message);
      throw new Fault(
        auth
          ? "ACCOUNT_CREDENTIAL_INVALID"
          : limited
            ? "REMOTE_RATE_LIMITED"
            : "REMOTE_REJECTED",
        redact(message, [key]),
        502,
        {
          platformCode: result.code,
          raw: redact(result, [key]),
          definitelyRejected: true,
        },
        false,
      );
    }
    return result.data;
  }
  async upload(key: string, bytes: Buffer, asset: Row) {
    const ticket = await this.api("/image/presignedUrl", key, {
      imageName: asset.storageKey,
    });
    const host = new URL(ticket.presignedUrl).hostname;
    requireThat(
      /(?:^|\.)(?:amazonaws\.com|bnbstatic\.com|binance\.com)$/.test(host),
      "UPLOAD_HOST_NOT_ALLOWED",
      "远端返回的上传域名不受支持。",
    );
    await this.http.request(
      ticket.presignedUrl,
      { method: "PUT", headers: { "Content-Type": asset.mime }, body: bytes },
      { allowedHosts: [host], secrets: [key], timeoutMs: 90000 },
    );
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await this.api("/image/imageStatus", key, {
        fileTicket: ticket.fileTicket,
      });
      if (Number(result.status) === 1 && result.imageUrl)
        return result.imageUrl;
      if (Number(result.status) === 2)
        throw new Fault(
          "IMAGE_UPLOAD_REJECTED",
          String(result.failedReason || "图片处理失败。"),
          502,
          { raw: redact(result, [key]) },
        );
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Fault(
      "IMAGE_UPLOAD_PENDING",
      "图片上传尚未完成；不会提交帖子。",
      503,
    );
  }
  async publish(key: string, text: string, images: string[]) {
    const result = await this.api(
      "/content/add",
      key,
      { contentType: 1, bodyTextOnly: text, imageList: images },
      "v1",
    );
    requireThat(
      result?.id,
      "PUBLISH_RESULT_UNKNOWN",
      "远端返回成功但没有帖子标识，需要核对。",
      502,
      { raw: redact(result, [key]) },
    );
    return {
      id: String(result.id),
      url:
        result.shareLink ||
        `https://www.binance.com/zh-CN/square/post/${result.id}`,
      receipt: redact(result, [key]),
      confirmedAt: now(),
    };
  }
  async verify(remoteId: string) {
    requireThat(
      /^\d+$/.test(remoteId),
      "INVALID_REMOTE_ID",
      "远端帖子标识必须为数字。",
    );
    const response = await this.http.request(
      `https://www.binance.com/bapi/composite/v3/friendly/pgc/special/content/detail/${remoteId}`,
      { headers: { clienttype: "web", lang: "zh-CN" } },
      { allowedHosts: ["www.binance.com"] },
    );
    const result = response.json();
    requireThat(
      result.code === "000000" && result.data,
      "PUBLIC_POST_UNAVAILABLE",
      "公开内容尚不可读。",
      502,
      { platformCode: result.code },
    );
    const d = result.data;
    return {
      id: String(d.id),
      authorUid: d.authorId || d.userId || d.uid || null,
      text: normalize(d.bodyTextOnly || ""),
      tokens: (d.coinPairList || []).map((s: string) =>
        s.replace(/^\$/, "").trim(),
      ),
      images: d.imageList || [],
      url: d.webLink || null,
    };
  }
}
