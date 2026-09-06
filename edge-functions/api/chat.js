const SYSTEM_PROMPT = `你是“AI教研助手”，服务于培训、干部教育、终身教育、企业培训等教研场景。

你现在会收到一组来自正式师资课程数据库的候选数据。

必须遵守：
1. 优先使用数据库中 source_type = “库内师资”、status = active 的老师。
2. 只有 confirmed_status = confirmed 且课程 status = active 的教师-课程关系，才允许进入“正式推荐”。
3. 不得编造数据库中不存在的老师、单位、课程名称、授课经历或来源。
4. 数据库没有合适师资时，明确写“待匹配”，不要为了填满课表而虚构。
5. 中介师资、待开发师资、网络师资只能放在“外部候选补充”中，不得混入正式课表。
6. pending 关系不能作为正式推荐。
7. disabled 教师或 disabled 课程不得用于新正式推荐。
8. 推荐理由必须说明：匹配了什么需求、依据了哪些数据库字段、哪些事项仍待确认。
9. 使用简体中文，输出专业、结构化、可直接用于教研讨论。
10. 当用户要求课表/课程方案时，优先输出表格，至少包含：天数/时段、课程模块、课程名称、推荐师资、单位、师资来源、推荐理由、待确认事项。
11. 如果用户只是普通咨询，不必强行生成课表，但仍不得虚构数据库事实。`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function cloudbaseGet(envId, apiKey, table, query = "") {
  const base = `https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`;
  const url = query ? `${base}?${query}` : base;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json"
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`CloudBase ${table} 查询失败 ${res.status}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`CloudBase ${table} 返回非 JSON 数据`);
  }
}

function buildFacultyContext(teachers, courses, relations) {
  const teacherMap = new Map(teachers.map(t => [t.business_code, t]));
  const courseMap = new Map(courses.map(c => [c.business_code, c]));

  const formal = [];
  const external = [];

  for (const r of relations) {
    const t = teacherMap.get(r.teacher_business_code);
    const c = courseMap.get(r.course_business_code);

    if (!t || !c) continue;
    if (t.status !== "active") continue;
    if (c.status !== "active") continue;
    if (r.confirmed_status !== "confirmed") continue;

    const item = {
      teacher_business_code: t.business_code,
      teacher_name: t.name,
      institution: t.institution,
      department: t.department,
      research_topics: t.research_topics,
      teacher_audiences: t.audiences,
      source_type: t.source_type,
      course_business_code: c.business_code,
      course_title: c.title,
      course_topics: c.topics,
      course_audiences: c.audiences,
      duration: c.duration,
      relation_status: r.confirmed_status,
      evidence_note: r.evidence_note
    };

    if (t.source_type === "库内师资") {
      formal.push(item);
    } else {
      external.push(item);
    }
  }

  return { formal, external };
}

export async function onRequestPost(context) {
  try {
    const deepseekKey = context.env.DEEPSEEK_API_KEY;
    const cloudbaseEnvId = context.env.CLOUDBASE_ENV_ID;
    const cloudbaseApiKey = context.env.CLOUDBASE_API_KEY;

    if (!deepseekKey) return json({ error: "服务器未配置 DEEPSEEK_API_KEY" }, 500);
    if (!cloudbaseEnvId) return json({ error: "服务器未配置 CLOUDBASE_ENV_ID" }, 500);
    if (!cloudbaseApiKey) return json({ error: "服务器未配置 CLOUDBASE_API_KEY" }, 500);

    const body = await context.request.json();
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const messages = incoming
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-12);

    if (!messages.length) return json({ error: "messages 不能为空" }, 400);

    const [teachers, courses, relations] = await Promise.all([
      cloudbaseGet(
        cloudbaseEnvId,
        cloudbaseApiKey,
        "teachers",
        "select=business_code,name,institution,department,research_topics,audiences,source_type,status&is_test_data=eq.true"
      ),
      cloudbaseGet(
        cloudbaseEnvId,
        cloudbaseApiKey,
        "courses",
        "select=business_code,title,topics,audiences,duration,status&is_test_data=eq.true"
      ),
      cloudbaseGet(
        cloudbaseEnvId,
        cloudbaseApiKey,
        "teacher_courses",
        "select=relation_code,teacher_business_code,course_business_code,confirmed_status,evidence_note&is_test_data=eq.true"
      )
    ]);

    const faculty = buildFacultyContext(teachers, courses, relations);

    const dbContext = `
【正式师资课程候选】
${JSON.stringify(faculty.formal, null, 2)}

【外部候选补充】
${JSON.stringify(faculty.external, null, 2)}

注意：
- “正式师资课程候选”才可以进入正式课表。
- “外部候选补充”只能单独列出。
- 如果正式库匹配不足，必须保留“待匹配”。
`;

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${deepseekKey}`
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: dbContext },
          ...messages
        ],
        thinking: { type: "disabled" },
        max_tokens: 2600,
        stream: false
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || `DeepSeek API 返回 ${response.status}`;
      return json({ error: message }, 502);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) return json({ error: "模型未返回有效内容" }, 502);

    return json({
      content,
      meta: {
        formal_candidates: faculty.formal.length,
        external_candidates: faculty.external.length,
        data_source: "CloudBase PostgreSQL"
      }
    });

  } catch (error) {
    return json({ error: error?.message || "服务器内部错误" }, 500);
  }
}

export async function onRequestGet(context) {
  const cloudbaseEnvId = context.env.CLOUDBASE_ENV_ID;
  const cloudbaseApiKey = context.env.CLOUDBASE_API_KEY;

  const result = {
    ok: true,
    service: "AI Workbench Chat API",
    deepseek_configured: Boolean(context.env.DEEPSEEK_API_KEY),
    cloudbase_configured: Boolean(cloudbaseEnvId && cloudbaseApiKey)
  };

  if (cloudbaseEnvId && cloudbaseApiKey) {
    try {
      const teachers = await cloudbaseGet(
        cloudbaseEnvId,
        cloudbaseApiKey,
        "teachers",
        "select=business_code&is_test_data=eq.true"
      );
      result.database_ok = true;
      result.test_teacher_count = Array.isArray(teachers) ? teachers.length : 0;
    } catch (e) {
      result.database_ok = false;
      result.database_error = e.message;
    }
  }

  return json(result);
}
