const SYSTEM_PROMPT = `你是“AI教研助手”，服务于培训、干部教育、终身教育、企业培训等教研场景。

规则：
1. 正式课表只能使用服务端提供的 formal_candidates。
2. 不得编造老师、单位、课程名称、来源或教师课程关系。
3. external_candidates 只能作为外部候选补充，不能进入正式课表。
4. 如果正式候选不足，对应时段写“待匹配”。
5. 推荐理由面向业务人员写清楚“为什么匹配”，不要大段展示内部字段名。
6. 使用简体中文。
7. 必须输出严格 JSON，不要 Markdown，不要 JSON 之外的文字。`;

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
  if (!res.ok) throw new Error(`CloudBase ${table} 查询失败 ${res.status}: ${text.slice(0, 300)}`);

  try { return JSON.parse(text); }
  catch { throw new Error(`CloudBase ${table} 返回非 JSON 数据`); }
}

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

async function callDeepSeek(apiKey, messages, maxTokens = 1800) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages,
      thinking: { type: "disabled" },
      max_tokens: maxTokens,
      stream: false
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `DeepSeek API 返回 ${res.status}`);
  return data?.choices?.[0]?.message?.content || "";
}

function parseDays(text) {
  const m = text.match(/(\d+)\s*天/);
  return m ? Math.max(1, Number(m[1])) : 1;
}

function guessSessions(text, days) {
  if (/上午.*下午|上午和下午|上午下午|每天.*2\s*讲|每天.*两\s*讲|各\s*1\s*讲|各一讲/.test(text)) return days * 2;
  const m = text.match(/(\d+)\s*(?:讲|门课|课次)/);
  if (m) return Math.max(1, Number(m[1]));
  return days === 1 ? 2 : days * 2;
}

function heuristicRequirement(text) {
  let audience = "";
  if (/金融机构干部/.test(text)) audience = "金融机构干部";
  else if (/农商行/.test(text)) audience = "农商行中高层";
  else if (/国企中层/.test(text)) audience = "国企中层";
  else if (/国企高管/.test(text)) audience = "国企高管";
  else if (/党政干部/.test(text)) audience = "党政干部";
  else if (/园区干部/.test(text)) audience = "园区干部";

  let industry = "";
  if (/银行|农商行|金融机构|金融中心|跨境金融/.test(text)) industry = "金融";
  else if (/国企/.test(text)) industry = "国有企业";
  else if (/园区|招商引资|区域经济/.test(text)) industry = "区域经济/园区";
  else if (/党政|治理/.test(text)) industry = "党政/公共治理";

  const days = parseDays(text);
  const sessions = guessSessions(text, days);

  return {
    audience: audience || "未明确",
    industry: industry || "未明确",
    theme: text
      .replace(/请.*$/g, "")
      .replace(/，?\d+\s*天.*$/g, "")
      .trim() || text,
    days: `${days}天`,
    sessions: `${sessions}讲`,
    goals: "围绕用户主题形成结构完整、师资可核查的专题课程方案",
    assumptions: []
  };
}

async function parseRequirement(apiKey, userText) {
  const prompt = `从下面培训需求中提取结构化信息，只输出 JSON：

{
  "audience": "",
  "industry": "",
  "theme": "",
  "days": "",
  "sessions": "",
  "goals": "",
  "assumptions": []
}

规则：
- days 使用“1天/2天/3天”格式。
- sessions 使用“2讲/4讲/6讲”格式。
- 如果用户明确说上午和下午各一讲，1天=2讲，2天=4讲，3天=6讲。
- theme 提炼培训主题，不要把整句需求原样复制。
- 信息不足才写“未明确”。

用户需求：
${userText}`;

  try {
    const raw = await callDeepSeek(apiKey, [
      { role: "system", content: "你是培训需求解析器。严格输出 JSON，不要其他文字。" },
      { role: "user", content: prompt }
    ], 900);

    const parsed = extractJson(raw);
    if (parsed && typeof parsed === "object") {
      const fallback = heuristicRequirement(userText);
      return {
        audience: parsed.audience || fallback.audience,
        industry: parsed.industry || fallback.industry,
        theme: parsed.theme || fallback.theme,
        days: parsed.days || fallback.days,
        sessions: parsed.sessions || fallback.sessions,
        goals: parsed.goals || fallback.goals,
        assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : []
      };
    }
  } catch {}

  return heuristicRequirement(userText);
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
      research_topics: t.research_topics || "",
      teacher_audiences: t.audiences || "",
      source_type: t.source_type,
      course_business_code: c.business_code,
      course_title: c.title,
      course_topics: c.topics || "",
      course_audiences: c.audiences || "",
      duration: c.duration || "",
      evidence_note: r.evidence_note || ""
    };

    if (t.source_type === "库内师资") formal.push(item);
    else external.push(item);
  }

  return { formal, external };
}

function splitTerms(text) {
  return String(text || "")
    .split(/[；;、，,\s/｜|：:]+/)
    .map(x => x.trim())
    .filter(x => x.length >= 2);
}

function scoreCandidate(candidate, req, rawText) {
  const haystack = [
    candidate.course_title,
    candidate.course_topics,
    candidate.research_topics,
    candidate.course_audiences,
    candidate.teacher_audiences,
    candidate.institution,
    candidate.department
  ].join(" ");

  const terms = new Set([
    ...splitTerms(req.theme),
    ...splitTerms(req.audience),
    ...splitTerms(req.industry),
    ...splitTerms(rawText)
  ]);

  let score = 0;
  const reasons = [];

  for (const term of terms) {
    if (!term || term === "未明确") continue;
    if (candidate.course_title.includes(term)) {
      score += 8;
      reasons.push(`课程名称匹配“${term}”`);
    } else if (candidate.course_topics.includes(term)) {
      score += 6;
      reasons.push(`课程主题匹配“${term}”`);
    } else if (candidate.research_topics.includes(term)) {
      score += 5;
      reasons.push(`研究方向匹配“${term}”`);
    } else if (candidate.course_audiences.includes(term) || candidate.teacher_audiences.includes(term)) {
      score += 3;
      reasons.push(`适用对象匹配“${term}”`);
    }
  }

  // 对常见复合主题增强召回
  const boosts = [
    ["国际金融中心", ["国际金融", "金融中心"]],
    ["跨境金融", ["跨境金融", "人民币国际化"]],
    ["人工智能", ["人工智能", "大模型", "AI"]],
    ["数字化转型", ["数字化转型", "数字化"]],
    ["数据要素", ["数据要素", "数字经济"]],
    ["风险管理", ["风险管理", "智能风控"]],
    ["业财融合", ["业财融合", "财务数字化"]]
  ];

  for (const [needle, aliases] of boosts) {
    if (rawText.includes(needle)) {
      for (const a of aliases) {
        if (haystack.includes(a)) {
          score += 7;
          reasons.push(`与“${needle}”方向高度匹配`);
          break;
        }
      }
    }
  }

  return { ...candidate, match_score: score, match_reasons: [...new Set(reasons)].slice(0, 4) };
}

function rankCandidates(candidates, req, rawText) {
  return candidates
    .map(c => scoreCandidate(c, req, rawText))
    .sort((a, b) => b.match_score - a.match_score);
}

function parseSessionCount(req) {
  const m = String(req.sessions || "").match(/(\d+)/);
  return m ? Math.max(1, Number(m[1])) : 2;
}

function makeSlots(req) {
  const dayMatch = String(req.days || "").match(/(\d+)/);
  const days = dayMatch ? Math.max(1, Number(dayMatch[1])) : 1;
  const count = parseSessionCount(req);

  const slots = [];
  for (let i = 0; i < count; i++) {
    const day = Math.min(days, Math.floor(i / 2) + 1);
    const period = i % 2 === 0 ? "上午" : "下午";
    slots.push({ day: `第${day}天`, period });
  }
  return slots;
}

function deterministicFallback(req, rankedFormal, rankedExternal) {
  const slots = makeSlots(req);
  const usedCourses = new Set();

  const formal_schedule = slots.map(slot => {
    const candidate =
      rankedFormal.find(x => x.match_score > 0 && !usedCourses.has(x.course_business_code)) ||
      rankedFormal.find(x => !usedCourses.has(x.course_business_code));

    if (!candidate) {
      return {
        ...slot,
        module: req.theme || "专题课程",
        course_title: "待匹配",
        teacher_name: "待匹配",
        institution: "",
        source_type: "",
        reason: "当前正式师资课程库暂未找到满足条件的确认关系。",
        evidence: "",
        pending: "补充或确认正式师资"
      };
    }

    usedCourses.add(candidate.course_business_code);

    return {
      ...slot,
      module: candidate.course_topics?.split(/[；;]/)[0] || req.theme || "专题课程",
      course_title: candidate.course_title,
      teacher_name: candidate.teacher_name,
      institution: [candidate.institution, candidate.department].filter(Boolean).join(" "),
      source_type: candidate.source_type,
      reason: candidate.match_reasons.length
        ? candidate.match_reasons.join("；")
        : "课程主题、适用对象与培训需求具有较高相关性。",
      evidence: `正式师资课程关系已确认；课程编号 ${candidate.course_business_code}；教师编号 ${candidate.teacher_business_code}`,
      pending: "确认教师档期及最终授课内容"
    };
  });

  const external_candidates = rankedExternal
    .filter(x => x.match_score > 0)
    .slice(0, 3)
    .map(x => ({
      teacher_name: x.teacher_name,
      institution: x.institution,
      source_type: x.source_type,
      suggested_topic: x.course_title,
      reason: x.match_reasons.join("；") || "与培训主题存在匹配点。",
      notice: "未入正式库，需核验"
    }));

  return {
    mode: "plan",
    assistant_message: "已根据培训需求和正式师资课程库生成结构化方案。",
    requirement_summary: req,
    formal_schedule,
    external_candidates,
    pending_items: ["正式推荐仍需确认教师档期与最终授课内容。"],
    suggested_actions: ["调整课程顺序", "更换指定时段老师", "更换指定课程", "导出课表"]
  };
}

async function generatePlan(apiKey, req, rankedFormal, rankedExternal) {
  const slots = makeSlots(req);

  const prompt = `请根据下面信息生成结构化培训方案，只输出 JSON。

需求：
${JSON.stringify(req, null, 2)}

需要的时段：
${JSON.stringify(slots, null, 2)}

正式候选（已经过服务端资格过滤与相关性排序）：
${JSON.stringify(rankedFormal.slice(0, 12), null, 2)}

外部候选补充：
${JSON.stringify(rankedExternal.filter(x => x.match_score > 0).slice(0, 6), null, 2)}

输出结构：
{
  "mode": "plan",
  "assistant_message": "",
  "requirement_summary": ${JSON.stringify(req)},
  "formal_schedule": [
    {
      "day": "",
      "period": "",
      "module": "",
      "course_title": "",
      "teacher_name": "",
      "institution": "",
      "source_type": "库内师资",
      "reason": "",
      "evidence": "",
      "pending": ""
    }
  ],
  "external_candidates": [
    {
      "teacher_name": "",
      "institution": "",
      "source_type": "",
      "suggested_topic": "",
      "reason": "",
      "notice": "未入正式库，需核验"
    }
  ],
  "pending_items": [],
  "suggested_actions": []
}

要求：
- formal_schedule 数量尽量与需要时段数一致。
- 只能从正式候选中选择正式师资和课程。
- 优先选择 match_score 高的候选。
- 同一天上午下午尽量不要重复同一门课程。
- 如果候选不足，保留“待匹配”。
- requirement_summary 必须直接使用上面的需求值，不要重新置空。`;

  const raw = await callDeepSeek(apiKey, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt }
  ], 2600);

  return extractJson(raw);
}

function normalizePlan(modelPlan, fallbackPlan, req) {
  if (!modelPlan || typeof modelPlan !== "object") return fallbackPlan;

  const formal = Array.isArray(modelPlan.formal_schedule) && modelPlan.formal_schedule.length
    ? modelPlan.formal_schedule
    : fallbackPlan.formal_schedule;

  return {
    mode: "plan",
    assistant_message: modelPlan.assistant_message || fallbackPlan.assistant_message,
    requirement_summary: {
      ...req,
      ...(modelPlan.requirement_summary || {})
    },
    formal_schedule: formal,
    external_candidates: Array.isArray(modelPlan.external_candidates)
      ? modelPlan.external_candidates
      : fallbackPlan.external_candidates,
    pending_items: Array.isArray(modelPlan.pending_items)
      ? modelPlan.pending_items
      : fallbackPlan.pending_items,
    suggested_actions: Array.isArray(modelPlan.suggested_actions)
      ? modelPlan.suggested_actions
      : fallbackPlan.suggested_actions
  };
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

    const latestUser = [...messages].reverse().find(m => m.role === "user");
    if (!latestUser) return json({ error: "缺少用户需求" }, 400);

    const userText = latestUser.content;
    const req = await parseRequirement(deepseekKey, userText);

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
    const rankedFormal = rankCandidates(faculty.formal, req, userText);
    const rankedExternal = rankCandidates(faculty.external, req, userText);

    const fallbackPlan = deterministicFallback(req, rankedFormal, rankedExternal);

    let modelPlan = null;
    try {
      modelPlan = await generatePlan(deepseekKey, req, rankedFormal, rankedExternal);
    } catch {}

    const plan = normalizePlan(modelPlan, fallbackPlan, req);

    return json({
      ...plan,
      meta: {
        formal_candidates: faculty.formal.length,
        external_candidates: faculty.external.length,
        top_formal_matches: rankedFormal.slice(0, 5).map(x => ({
          teacher: x.teacher_name,
          course: x.course_title,
          score: x.match_score
        })),
        data_source: "CloudBase PostgreSQL",
        pipeline: "parse -> deterministic match -> LLM compose -> fallback"
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
    version: "1.1.1",
    structured_output: true,
    deterministic_matching: true,
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
