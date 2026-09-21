const tokenCache = {
  value: "",
  expiresAt: 0,
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing Cloudflare environment variable: ${name}`);
  return value;
}

async function getDingTalkAccessToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appKey: requireEnv(env, "DINGTALK_APP_KEY"),
      appSecret: requireEnv(env, "DINGTALK_APP_SECRET"),
    }),
  });
  const body = await response.json();

  if (!response.ok || !body.accessToken) {
    throw new Error(`DingTalk token failed: ${JSON.stringify(body)}`);
  }

  tokenCache.value = body.accessToken;
  tokenCache.expiresAt = Date.now() + Math.max(60, Number(body.expireIn || 7200) - 120) * 1000;
  return tokenCache.value;
}

function normalizeApprovalPayload(env, draft) {
  return {
    process_code: env.DINGTALK_PROCESS_CODE || draft.process_code,
    originator_user_id: env.DINGTALK_ORIGINATOR_USER_ID || draft.originator_user_id,
    dept_id: env.DINGTALK_DEPT_ID || draft.dept_id,
    form_component_values: draft.form_component_values,
    remark: draft.remark,
  };
}

async function createApproval(request, env) {
  const draft = await request.json();
  const accessToken = await getDingTalkAccessToken(env);
  const payload = normalizeApprovalPayload(env, draft);

  const response = await fetch(`https://oapi.dingtalk.com/topapi/processinstance/create?access_token=${accessToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();

  if (!response.ok || body.errcode !== 0) {
    return json({ error: "DingTalk approval failed", raw: body, request: payload }, 502);
  }

  return json({
    processInstanceId: body.process_instance_id,
    request: payload,
    raw: body,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/approvals") {
      if (request.method === "OPTIONS") return json({}, 204);
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

      try {
        return await createApproval(request, env);
      } catch (error) {
        return json({ error: error.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
