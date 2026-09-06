const SYSTEM_PROMPT = `你是“AI教研助手”，服务于培训、干部教育、终身教育、企业培训等教研场景。

你的工作原则：
1. 输出要专业、结构化、可直接用于教研和方案讨论。
2. 优先关注培训对象、培训目标、课程结构、模块逻辑、专题名称、师资方向、教学方式和落地性。
3. 当用户要求课程框架时，优先给出：定位/目标、模块结构、课程主题、核心内容、教学方式、师资方向。
4. 当用户要求班次命名时，名称应庄重、简洁、易传播，避免空泛和过度营销。
5. 当信息不足时，可以基于合理假设先给出可用版本，并明确关键假设，不要反复追问。
6. 使用简体中文回答，除非用户明确要求其他语言。
7. 不要虚构具体老师、机构合作或事实性成果；如用户未提供可靠信息，用“师资方向”或“建议类型”表达。
8. 默认不输出冗长理论背景，优先给可执行成果。`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost(context) {
  try {
    const apiKey = context.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return json({ error: "服务器未配置 DEEPSEEK_API_KEY" }, 500);
    }

    const body = await context.request.json();
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const messages = incoming
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-12);

    if (!messages.length) {
      return json({ error: "messages 不能为空" }, 400);
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages
        ],
        thinking: { type: "disabled" },
        max_tokens: 2200,
        stream: false
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || `DeepSeek API 返回 ${response.status}`;
      return json({ error: message }, 502);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return json({ error: "模型未返回有效内容" }, 502);
    }

    return json({ content });
  } catch (error) {
    return json({ error: error?.message || "服务器内部错误" }, 500);
  }
}

export function onRequestGet() {
  return json({ ok: true, service: "AI Workbench Chat API" });
}
