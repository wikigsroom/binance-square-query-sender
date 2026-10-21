import { Doc, Row, Store, requireThat } from "./core.js";

export const protocols = [
  {
    id: "openai_chat_images",
    name: "OpenAI Chat Completions",
    textPath: "chat/completions",
    images: true,
  },
  {
    id: "openai_responses_images",
    name: "OpenAI Responses",
    textPath: "responses",
    images: true,
  },
  {
    id: "anthropic_messages",
    name: "Anthropic Messages",
    textPath: "messages",
    images: false,
  },
];
export const providerProfiles = [
  {
    id: "custom",
    name: "自定义 / 兼容网关",
    short: "API",
    baseUrl: "",
    protocol: "openai_chat_images",
    description: "填写你自己的服务地址，保留上游实际模型 ID。",
  },
  {
    id: "openai",
    name: "OpenAI",
    short: "O",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai_responses_images",
    description: "Responses 文字接口，GPT Image 2 使用 Images 接口。",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    short: "A",
    baseUrl: "https://api.anthropic.com/v1",
    protocol: "anthropic_messages",
    description: "原生 Messages 文字接口，使用独立的 API Key。",
  },
];
export function protocolFor(connection: Doc) {
  const protocol = protocols.find(
    (p) => p.id === (connection.protocol || "openai_chat_images"),
  );
  requireThat(protocol, "INVALID_AI_PROTOCOL", "请选择受支持的 AI 请求协议。");
  return protocol!;
}
export function providerHeaders(connection: Doc, key: string) {
  return protocolFor(connection).id === "anthropic_messages"
    ? {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      }
    : { Authorization: `Bearer ${key}`, "content-type": "application/json" };
}
export function textRequest(
  connection: Doc,
  model: Doc,
  messages: Doc[],
  parameters: Doc,
) {
  const protocol = protocolFor(connection),
    p = { ...parameters };
  // These fields describe the transport, and cannot be supplied through model parameters.
  requireThat(
    !Object.keys(p).some((k) =>
      [
        "model",
        "messages",
        "input",
        "instructions",
        "system",
        "stream",
        "store",
        "background",
        "tools",
        "previous_response_id",
        "conversation",
      ].includes(k),
    ),
    "UNSUPPORTED_MODEL_PARAMETER",
    "模型参数不能覆盖请求正文、系统提示词或传输方式。",
  );
  let body: Doc;
  if (protocol.id === "openai_responses_images") {
    requireThat(
      !(p.max_tokens !== undefined && p.max_output_tokens !== undefined),
      "UNSUPPORTED_MODEL_PARAMETER",
      "max_tokens 与 max_output_tokens 只能设置一个。",
    );
    if (p.max_tokens !== undefined) {
      p.max_output_tokens = p.max_tokens;
      delete p.max_tokens;
    }
    if (p.reasoning_effort !== undefined) {
      p.reasoning = { ...p.reasoning, effort: p.reasoning_effort };
      delete p.reasoning_effort;
    }
    body = {
      ...p,
      model: model.externalId,
      input: messages,
      stream: false,
      store: false,
    };
  } else if (protocol.id === "anthropic_messages") {
    requireThat(
      p.reasoning_effort === undefined && p.max_output_tokens === undefined,
      "UNSUPPORTED_MODEL_PARAMETER",
      "Messages 协议请使用原生参数，例如 max_tokens、temperature、thinking。",
    );
    body = {
      max_tokens: 2048,
      ...p,
      model: model.externalId,
      system: messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n"),
      messages: messages.filter((m) => m.role !== "system"),
      stream: false,
    };
  } else body = { ...p, model: model.externalId, messages, stream: false };
  return {
    url: `${connection.baseUrl.replace(/\/$/, "")}/${protocol.textPath}`,
    body,
  };
}
export function textOutput(connection: Doc, raw: Doc): string | undefined {
  const protocol = protocolFor(connection).id;
  if (protocol === "openai_responses_images") {
    requireThat(
      raw.status === undefined || raw.status === "completed",
      "TEXT_MODEL_INCOMPLETE",
      "Responses 请求尚未完整结束，不能使用部分正文。",
      502,
      {
        status: raw.status,
        error: raw.error,
        incompleteDetails: raw.incomplete_details,
      },
    );
    const blocks = (raw.output || [])
      .filter((o: Doc) => o.type === "message")
      .flatMap((o: Doc) => o.content || [])
      .filter(
        (b: Doc) => b.type === "output_text" && typeof b.text === "string",
      );
    return blocks.length ? blocks.map((b: Doc) => b.text).join("") : undefined;
  }
  if (protocol === "anthropic_messages") {
    requireThat(
      raw.stop_reason === undefined ||
        raw.stop_reason === "end_turn" ||
        raw.stop_reason === "stop_sequence",
      "TEXT_MODEL_INCOMPLETE",
      "Messages 请求未完整生成正文。",
      502,
      { stopReason: raw.stop_reason },
    );
    const blocks = (raw.content || []).filter(
      (b: Doc) => b.type === "text" && typeof b.text === "string",
    );
    return blocks.length ? blocks.map((b: Doc) => b.text).join("") : undefined;
  }
  return raw.choices?.[0]?.message?.content;
}
export async function resolveModel(
  t: Store,
  requestedId: string,
  type: "text" | "image",
) {
  const defaults =
    requestedId === "@default" ? await t.need("runtime", "ai") : null;
  const modelId = defaults
    ? defaults[type === "text" ? "defaultTextModelId" : "defaultImageModelId"]
    : requestedId;
  requireThat(
    modelId,
    "AI_DEFAULT_NOT_CONFIGURED",
    `请先在 AI 接入中设置默认${type === "text" ? "文字" : "图片"}模型。`,
    409,
  );
  const model = await t.get("models", modelId);
  const connection = model
    ? await t.get("connections", model.connectionId)
    : null;
  requireThat(
    model?.approved &&
      model.type === type &&
      connection?.enabled &&
      (type !== "image" ||
        (model.family === "gpt-image-2" && protocolFor(connection).images)),
    type === "text" ? "TEXT_MODEL_UNAVAILABLE" : "IMAGE_MODEL_UNAVAILABLE",
    `所选${type === "text" ? "文字" : "图片"}模型尚未批准、连接未启用或协议不支持。`,
    409,
  );
  return {
    model: model as Row,
    connection: connection as Row,
    defaultsVersion: defaults?.version || null,
    requestedId,
  };
}
export async function resolveRules(t: Store, original: Doc) {
  const rules = structuredClone(original),
    text = await resolveModel(t, rules.modelId, "text");
  rules.modelId = text.model.id;
  const image =
    rules.image.mode !== "library"
      ? await resolveModel(t, rules.image.modelId, "image")
      : null;
  if (image) rules.image.modelId = image.model.id;
  return {
    rules,
    modelSelection: {
      text: {
        requestedId: text.requestedId,
        modelId: text.model.id,
        connectionId: text.connection.id,
        defaultsVersion: text.defaultsVersion,
      },
      image: image
        ? {
            requestedId: image.requestedId,
            modelId: image.model.id,
            connectionId: image.connection.id,
            defaultsVersion: image.defaultsVersion,
          }
        : null,
    },
  };
}
