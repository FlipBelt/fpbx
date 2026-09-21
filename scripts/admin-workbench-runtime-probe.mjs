import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminWorkbench } from "../admin-workbench.mjs";

const rootPath = fileURLToPath(new URL("../", import.meta.url));
const localConfig = JSON.parse(await readFile(new URL("../dingtalk.config.json", import.meta.url), "utf8"));
const workbench = await createAdminWorkbench({
  root: rootPath,
  dataDirectory: join(rootPath, "data"),
  localConfig,
});

try {
  const health = await workbench.health();
  const archive = await workbench.verifyArchiveAccess();
  if (health.mysql !== "ok" || !archive.bucket) throw new Error("管理员工作台运行探针失败。");
  console.log(JSON.stringify({
    mysql: health.mysql,
    retentionDays: health.retentionDays,
    archiveEnabled: health.archiveEnabled,
    bucket: archive.bucket,
    location: archive.location,
  }));
} finally {
  await workbench.close();
}
