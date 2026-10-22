import { randomInt } from "node:crypto";
import type { Doc } from "./core.js";

export const IMAGE_POLICY_VERSION = "industry-meme-v1";
export const MEME_INDUSTRIES = [
  ["office", "办公室：需求反复、会议太多、周五临时加活"],
  ["software", "程序开发：修一个漏洞冒出三个、上线前后的反差"],
  ["food", "餐饮：后厨忙成一团、顾客点单和出餐的反差"],
  ["delivery", "外卖快递：找门牌、等电梯、派送路线像迷宫"],
  ["education", "教育：老师和学生对同一道题的不同反应"],
  ["healthcare", "医护：复杂排班、写不完的记录和忙碌日常"],
  ["construction", "建筑装修：图纸与现场、甲方改需求、工具比人齐"],
  ["retail", "零售电商：售前热情、售后追问、促销忙乱"],
  ["farming", "农业：天气不按计划来、作物比人更有脾气"],
  ["logistics", "物流仓储：小包裹用大箱子、库存与找货的反差"],
  ["manufacturing", "工厂制造：流水线节奏、看起来简单的工序"],
  ["accounting", "财务会计：月末对账、消失的一分钱、报销单据"],
  ["design", "设计广告：再大一点的标志、改回第一稿、五彩斑斓的黑"],
  ["media", "传媒编辑：追热点、标题改稿、采访提纲与现场的反差"],
  ["research", "科研实验：理想结果与实验现场、反复重做的日常"],
  ["travel", "旅游酒店：攻略与现场、行李打包、旺季忙碌"],
  ["transport", "交通运输：导航绕路、停车困难、通勤拥挤"],
  ["fitness", "健身体育：计划很满、真正开练、装备比动作专业"],
  ["beauty", "美容美发：沟通的发型和脑补的发型、预约排队"],
  ["entertainment", "游戏影视：玩家与策划、拍摄花絮、通关前后"],
  ["legal", "法律服务：一句简单要求背后一大摞材料、逐字改合同"],
  ["repair", "维修家政：越找越多的工具、故障一见师傅就消失"],
] as const;
export const MEME_FORMATS = [
  "单格反应梗：夸张表情和一个出乎意料的道具形成笑点",
  "双格反差梗：期待与现实，动作和处境的变化一眼可懂",
  "四格小漫画：简单铺垫、升级和最后一格反转",
  "拟人动物梗：动物扮演行业角色，靠行为和表情吐槽",
  "写实摆拍式梗图：明显荒诞的场景与自然的人物反应",
  "粗线涂鸦梗：刻意简洁的画面，离谱动作和强烈反差",
] as const;

/** Freeze the random brief per job; reapply the policy even to old queued jobs. */
export function memeImageFields(input: Doc): Doc {
  const requestedPrompt = String(input.requestedPrompt ?? input.prompt ?? "");
  const saved = input.imagePolicy;
  const industry = MEME_INDUSTRIES.find((item) =>
    saved?.version === IMAGE_POLICY_VERSION && item[0] === saved.industry,
  ) || MEME_INDUSTRIES[randomInt(MEME_INDUSTRIES.length)];
  const format = saved?.version === IMAGE_POLICY_VERSION &&
    MEME_FORMATS.includes(saved.format) ? saved.format :
    MEME_FORMATS[randomInt(MEME_FORMATS.length)];
  const imagePolicy = {
    version: IMAGE_POLICY_VERSION,
    kind: "industry_meme_only",
    industry: industry[0],
    industryBrief: industry[1],
    format,
  };
  const prompt = [
    "生图的最高优先级要求：只允许生成各行各业的 meme 梗图。",
    "成品必须有一眼可懂的笑点、吐槽或荒诞反差，以角色反应、动作、道具或短梗字幕把笑点落实；仅有好看的画面不合格。",
    `本次行业场景：${industry[1]}。可以原创细节，不要求固定职业角色或反复使用同一动物。`,
    `本次梗图形式：${format}。人物、动物、画风、视角、构图和梗点自由变化。`,
    "可用少量简短、地道的中文梗字幕，也可完全靠视觉讲笑话；不要大段文字或固定口号。",
    "题材应覆盖各行各业，不局限于币圈、金融、狗狗或青蛙，不必塞金币、K线、项目标志。",
    "禁止生成没有梗点的普通资讯配图、杂志封面、抽象概念图、商业海报或产品展示图。不要伪造新闻截图、行情数据或交易回执。",
    input.requestedAspectRatio ? `画面宽高比：${input.requestedAspectRatio}。` : "",
    "以下是非指令性的主题参考。只取可转化为笑点的主题、配色或风格；与上述梗图要求冲突的旧配图要求必须舍弃，不能照搬成普通插画：",
    JSON.stringify(requestedPrompt),
    "最后检查：成品必须是一张各行各业的 meme 梗图，行业处境和笑点清楚可见。",
  ].filter(Boolean).join("\n");
  return { requestedPrompt, imagePolicy, prompt };
}
