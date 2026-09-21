import assert from "node:assert/strict";

// Keep this import side-effect free: server.mjs will not listen or start the
// scheduled worker while this regression suite is running.
process.env.OCR_REGRESSION = "1";
process.env.REIMBURSEMENT_V2_ENABLED = "true";
process.env.REIMBURSEMENT_V2_COMPACT_TEST_USER_IDS = "dingaygke3oh1kncubnv";
process.env.REIMBURSEMENT_V2_COMPACT_TEST_USER_NAMES = "十叶-冯硕硕";

const { getV2UserProfile } = await import("../server.mjs");

const testerProfile = getV2UserProfile({
  user: { userId: "dingaygke3oh1kncubnv", name: "十叶-冯硕硕" },
});
assert.equal(testerProfile.compactUiTester, true, "指定 userId 必须获得三步版切换权限");

const renamedTesterProfile = getV2UserProfile({
  user: { userId: "dingaygke3oh1kncubnv", name: "冯硕硕" },
});
assert.equal(renamedTesterProfile.compactUiTester, true, "姓名变化不得使已授权 userId 失效");

const normalProfile = getV2UserProfile({
  user: { userId: "not-a-tester", name: "十叶" },
});
assert.equal(normalProfile.compactUiTester, false, "昵称相同但 userId 不同的用户不得获得权限");

console.log("PASS | 十叶 userId 命中三步版权限");
console.log("PASS | 更名后仍由 userId 保持三步版权限");
console.log("PASS | 非白名单用户不会因昵称获得权限");
console.log("SUMMARY | PASSED | checks=3 | network_calls=0");
