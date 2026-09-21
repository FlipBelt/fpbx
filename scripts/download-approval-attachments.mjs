import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dingtalk from "@alicloud/dingtalk";
import OpenApi from "@alicloud/openapi-client";
import Util from "@alicloud/tea-util";

const businessId = String(process.argv[2] || "").trim();
if (!/^\d{12,32}$/.test(businessId)) throw new Error("请提供审批业务编号。");

const artifactPath = fileURLToPath(new URL(`../artifacts/approval-${businessId}.json`, import.meta.url));
const approval = JSON.parse(await readFile(artifactPath, "utf8"));
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
const accessToken = tokenBody.accessToken;

const workflow = dingtalk.workflow_1_0;
const openApiConfig = new OpenApi.Config({});
openApiConfig.protocol = "https";
openApiConfig.regionId = "central";
const client = new workflow.default(openApiConfig);
const runtime = new Util.RuntimeOptions({});
const downloadHeaders = new workflow.GrantProcessInstanceForDownloadFileHeaders({
  xAcsDingtalkAccessToken: accessToken,
});

const tableComponent = (approval.formComponentValues || []).find((item) => item.name === "表格");
const rows = JSON.parse(tableComponent?.value || "[]");
const outputDirectory = fileURLToPath(new URL(`../artifacts/approval-${businessId}-files/`, import.meta.url));
const manifest = [];

function safeName(value) {
  return String(value || "未命名")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 160) || "未命名";
}

for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
  const fields = Object.fromEntries((rows[rowIndex].rowValue || []).map((item) => [item.label, item.value]));
  const rowPrefix = `第${String(rowIndex + 1).padStart(2, "0")}行-${safeName(fields["申请事由"])}`;
  const groups = [
    ["付款", fields["付款截图/订单截图"]],
    ["发票", fields["对应发票上传"]],
  ];
  for (const [group, rawFiles] of groups) {
    const files = rawFiles ? JSON.parse(rawFiles) : [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      const originalName = safeName(file.fileName);
      const localName = `${group}${String(fileIndex + 1).padStart(2, "0")}-${originalName}`;
      const localPath = join(outputDirectory, rowPrefix, group, localName);
      await mkdir(dirname(localPath), { recursive: true });
      const infoResponse = await client.grantProcessInstanceForDownloadFileWithOptions(
        new workflow.GrantProcessInstanceForDownloadFileRequest({
          processInstanceId: approval.processInstanceId,
          fileId: String(file.fileId),
          withCommentAttatchment: false,
        }),
        downloadHeaders,
        runtime,
      );
      const resourceUrl = infoResponse?.body?.result?.downloadUri;
      if (!resourceUrl) throw new Error(`未取得审批附件下载地址：${originalName}`);
      const fileResponse = await fetch(resourceUrl);
      if (!fileResponse.ok) throw new Error(`下载失败 ${fileResponse.status}：${originalName}`);
      const buffer = Buffer.from(await fileResponse.arrayBuffer());
      await writeFile(localPath, buffer);
      manifest.push({
        row: rowIndex + 1,
        reason: fields["申请事由"],
        declaredAmount: fields["金额"],
        group,
        index: fileIndex + 1,
        originalName: file.fileName,
        localName: basename(localPath),
        localPath,
        expectedSize: Number(file.fileSize) || 0,
        downloadedSize: buffer.length,
      });
    }
  }
}

const manifestPath = join(outputDirectory, "manifest.json");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
console.log(JSON.stringify({
  businessId,
  outputDirectory,
  manifestPath,
  downloaded: manifest.length,
  paymentFiles: manifest.filter((item) => item.group === "付款").length,
  invoiceFiles: manifest.filter((item) => item.group === "发票").length,
  byteSizesMatched: manifest.every((item) => !item.expectedSize || item.expectedSize === item.downloadedSize),
}, null, 2));
