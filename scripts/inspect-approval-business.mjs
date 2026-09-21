import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dingtalk from "@alicloud/dingtalk";
import OpenApi from "@alicloud/openapi-client";
import Util from "@alicloud/tea-util";

const businessId = String(process.argv[2] || "").trim();
if (!/^\d{12,32}$/.test(businessId)) throw new Error("请提供审批业务编号。");

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await readFile(new URL("../dingtalk.config.json", import.meta.url), "utf8"));
const appKey = process.env.DINGTALK_APP_KEY || config.appKey;
const appSecret = process.env.DINGTALK_APP_SECRET || config.appSecret;
if (!appKey || !appSecret) throw new Error("钉钉应用凭证未配置。");

const tokenResponse = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ appKey, appSecret }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok || !tokenBody.accessToken) throw new Error("无法获取钉钉访问令牌。");

const workflow = dingtalk.workflow_1_0;
const openApiConfig = new OpenApi.Config({});
openApiConfig.protocol = "https";
openApiConfig.regionId = "central";
const client = new workflow.default(openApiConfig);
const runtime = new Util.RuntimeOptions({});
const headers = new workflow.ListProcessInstanceIdsHeaders({
  xAcsDingtalkAccessToken: tokenBody.accessToken,
});
const detailHeaders = new workflow.GetProcessInstanceHeaders({
  xAcsDingtalkAccessToken: tokenBody.accessToken,
});
const processCodes = [
  "PROC-8249A121-DBA1-4B54-A3F8-82D2A66703A5",
  "PROC-429BDF89-0899-4857-BED1-03C449C9FBC7",
  "PROC-04CE0467-D413-41B1-8686-10318BFA537B",
];
const startTime = Date.parse("2026-07-26T16:00:00.000Z");
const endTime = Date.parse("2026-07-29T16:00:00.000Z");
let matched;

for (const processCode of processCodes) {
  let nextToken = 0;
  for (let page = 0; page < 20 && !matched; page += 1) {
    const response = await client.listProcessInstanceIdsWithOptions(
      new workflow.ListProcessInstanceIdsRequest({
        processCode,
        startTime,
        endTime,
        maxResults: 20,
        nextToken,
      }),
      headers,
      runtime,
    );
    const result = response?.body?.result || {};
    for (const processInstanceId of result.list || []) {
      const detailResponse = await client.getProcessInstanceWithOptions(
        new workflow.GetProcessInstanceRequest({ processInstanceId }),
        detailHeaders,
        runtime,
      );
      const instance = detailResponse?.body?.result;
      if (String(instance?.businessId || "") === businessId) {
        matched = { ...instance, processInstanceId: instance.processInstanceId || processInstanceId };
        break;
      }
    }
    const candidate = result.nextToken;
    if (!candidate || Number(candidate) === Number(nextToken)) break;
    nextToken = Number(candidate);
  }
  if (matched) break;
}

if (!matched) throw new Error(`在目标流程和时间窗口内未找到业务编号 ${businessId}。`);

const artifactDirectory = new URL("../artifacts/", import.meta.url);
await mkdir(artifactDirectory, { recursive: true });
const artifactPath = new URL(`../artifacts/approval-${businessId}.json`, import.meta.url);
await writeFile(artifactPath, JSON.stringify(matched, null, 2), "utf8");

function sanitizeAttachmentValue(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  const sanitize = (item) => {
    if (Array.isArray(item)) return item.map(sanitize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => {
      if (/fileId|spaceId|downloadUrl|url|mediaId/i.test(key)) return [key, "[已脱敏]"];
      return [key, sanitize(child)];
    }));
  };
  return sanitize(parsed);
}

const sanitizedForms = (matched.formComponentValues || []).map((item) => {
  if (/收款.*账户|银行账号|银行卡号/i.test(item.name || "")) {
    return { name: item.name, componentType: item.componentType, value: "[账户信息已脱敏]" };
  }
  return {
    name: item.name,
    componentType: item.componentType,
    value: sanitizeAttachmentValue(item.value),
  };
});

console.log(JSON.stringify({
  businessId: matched.businessId,
  processInstanceId: matched.processInstanceId,
  processCode: matched.processCode,
  title: matched.title,
  status: matched.status,
  result: matched.result,
  createTime: matched.createTime,
  finishTime: matched.finishTime,
  originatorUserId: matched.originatorUserId,
  formComponentValues: sanitizedForms,
  rawArtifact: fileURLToPath(artifactPath),
  projectRoot,
}, null, 2));
