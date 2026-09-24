/**
 * ============================================================
 * NEBOSH IG1 練習模式 — Anthropic API 代理（Google Apps Script）
 * ============================================================
 * 用途：本機 HTML 練習頁呼叫這支 web app，由它去打 Anthropic Messages API。
 *       API 金鑰只存在這個專案的「指令碼屬性」，不會出現在 HTML 裡。
 *
 * 部署前必做一次：
 *   1. 編輯器 → 專案設定 → 指令碼屬性 → 新增
 *        ANTHROPIC_API_KEY = sk-ant-...        （必填）
 *        SHARED_SECRET     = 任意一串自訂字串   （選填，填了前端也要填同一串）
 *   2. 部署 → 新增部署 → 網頁應用程式
 *        執行身分：我　／　誰可以存取：所有人
 *   3. 把 /exec 網址貼進練習頁的「設定」欄位
 *
 * 模型：claude-opus-5（$5 / $25 每百萬 tokens）。
 *   - Opus 5 不接受 temperature / top_p / budget_tokens（會回 400）
 *   - thinking 預設就是 adaptive，不必也不應手動指定 budget
 *   - 已開啟 server-side fallback：安全分類器婉拒時自動改用備援模型完成同一次呼叫
 */

var ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
var MODEL = 'claude-opus-5';
var API_VERSION = '2023-06-01';
var FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/* ============================== 路由 ============================== */

function doGet(e) {
  // 健康檢查用：確認部署還活著、金鑰有沒有設好（不會回傳金鑰內容）
  var p = (e && e.parameter) || {};
  if (p.action === 'ping') {
    return json_({
      ok: true,
      service: 'NEBOSH IG1 practice proxy',
      model: MODEL,
      keySet: !!getProp_('ANTHROPIC_API_KEY'),
      secretRequired: !!getProp_('SHARED_SECRET'),
      time: new Date().toISOString()
    });
  }
  return json_({ ok: false, error: 'Use POST. GET 只支援 ?action=ping' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_JSON', message: '送來的不是合法 JSON' });
  }

  try {
    var need = getProp_('SHARED_SECRET');
    if (need && String(body.secret || '') !== String(need)) {
      return json_({ ok: false, error: 'FORBIDDEN', message: '通關密語不符，請檢查練習頁設定' });
    }

    switch (body.action) {
      case 'analyse': return json_(analyseScenario_(body));
      case 'grade':   return json_(gradeAnswer_(body));
      case 'ping':    return json_({ ok: true, model: MODEL, keySet: !!getProp_('ANTHROPIC_API_KEY') });
      default:        return json_({ ok: false, error: 'UNKNOWN_ACTION', message: '不認識的 action：' + body.action });
    }
  } catch (err) {
    return json_({ ok: false, error: 'SERVER', message: String(err && err.message || err) });
  }
}

/* ============================== 動作 1：情境分析 ============================== */

var ANALYSE_SYSTEM = [
  'You are an experienced NEBOSH International General Certificate (IG1) tutor helping a learner PREPARE for the open-book exam.',
  'You are given a practice scenario. Your job is to map it to the IG1 syllabus so the learner knows where to look and what to write about.',
  '',
  'Rules:',
  '1. Work only from the scenario text given. Do not invent facts that are not there.',
  '2. For every hit, quote the EXACT words from the scenario that triggered it. If you cannot quote it, do not list it.',
  '3. Use the official IG1 element numbering: 1.1 moral/legal/financial, 1.2 regulation and duties, 1.3 duties of leaders,',
  '   1.4 managing contractors, 2.1 management systems, 2.2 policy, 3.1 safety culture, 3.2 improving culture,',
  '   3.3 human factors, 3.4 assessing risk, 3.5 managing change, 3.6 safe systems of work, 3.7 permit to work,',
  '   3.8 emergency procedures and first aid, 4.1 investigating incidents, 4.2 monitoring, 4.3 auditing, 4.4 reviewing.',
  '4. "points" must be the actual technical points a marker would award, written as short exam-usable statements in English.',
  '   Do NOT write finished answer paragraphs — the learner must write those. Points are prompts, not prose to copy.',
  '5. Chinese fields are for comprehension only and should be short.',
  '6. Rank hits by how likely they are to carry marks. 6 to 12 hits is normal; do not pad.',
  '',
  'This is practice material. Never produce a submittable answer.'
].join('\n');

var ANALYSE_SCHEMA = {
  type: 'object',
  properties: {
    overview_zh: { type: 'string' },
    overview_en: { type: 'string' },
    hits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string' },
          title_en: { type: 'string' },
          title_zh: { type: 'string' },
          quote: { type: 'string' },
          why_zh: { type: 'string' },
          points: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['section', 'title_en', 'title_zh', 'quote', 'why_zh', 'points', 'confidence'],
        additionalProperties: false
      }
    },
    likely_tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          wording: { type: 'string' },
          command_word: { type: 'string' },
          marks: { type: 'integer' },
          sections: { type: 'array', items: { type: 'string' } },
          what_to_cover: { type: 'array', items: { type: 'string' } }
        },
        required: ['wording', 'command_word', 'marks', 'sections', 'what_to_cover'],
        additionalProperties: false
      }
    },
    hidden_clues_zh: { type: 'array', items: { type: 'string' } }
  },
  required: ['overview_zh', 'overview_en', 'hits', 'likely_tasks', 'hidden_clues_zh'],
  additionalProperties: false
};

function analyseScenario_(body) {
  var scenario = String(body.scenario || '').trim();
  if (scenario.length < 40) return { ok: false, error: 'TOO_SHORT', message: '情境太短，至少貼 40 個字元' };

  var res = callClaude_({
    system: ANALYSE_SYSTEM,
    user: 'SCENARIO 情境：\n\n' + scenario,
    schema: ANALYSE_SCHEMA,
    maxTokens: 12000,
    effort: effort_('ANALYSE_EFFORT')
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data, usage: res.usage, model: res.model };
}

/* ============================== 動作 2：答案批改 ============================== */

var GRADE_SYSTEM = [
  'You are a NEBOSH IG1 examiner marking a learner\'s PRACTICE answer, and a tutor explaining the marks.',
  '',
  'How IG1 is marked — apply this literally:',
  '· One mark = one technical point that is clearly demonstrated AND connected to the scenario.',
  '· A point that could be pasted into any other exam paper earns nothing: it must carry a fact that exists only in THIS scenario.',
  '· The command word sets the required shape. Identify/Give = name + context. Outline = name + brief description.',
  '  Describe = detailed factual account. Explain = reason with visible causation (because / so that / which means).',
  '  Comment on / Assess / Evaluate = judgement on adequacy supported by evidence. Justify = reasons for a decision.',
  '  Recommend / Suggest = specific actions with detail, purpose, owner and timescale. Answering in the wrong shape loses the mark.',
  '· The same failing written twice in different words scores once.',
  '· Roughly 30 words per mark is the expected length. Far under = underdeveloped; far over = wasted time, not extra marks.',
  '',
  'Your job:',
  '1. Award a score out of the marks available, and be strict — mark as the examiner would, not generously.',
  '2. For every mark you AWARD, quote the learner\'s own words that earned it and say why it counted.',
  '3. For every mark they MISSED, name the point, name the syllabus section it comes from, and describe in one line',
  '   WHAT THEY SHOULD HAVE COVERED — as direction, never as a finished sentence they could copy.',
  '4. Flag any paragraph that is generic (no scenario fact) by quoting it.',
  '5. Judge whether the command word shape was met.',
  '',
  'Hard rules:',
  '· NEVER write a model answer, a rewritten paragraph, or a sentence the learner could submit. Feedback and direction only.',
  '  If asked to, refuse in the overall_zh field and mark it clearly.',
  '· Quote the learner exactly when quoting; do not paraphrase into a better version.',
  '· Chinese fields: plain, direct, no flattery. English fields: exam register.',
  '· If the answer is empty or irrelevant, score 0 and say so.'
].join('\n');

var GRADE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    out_of: { type: 'number' },
    verdict_zh: { type: 'string' },
    command_word: {
      type: 'object',
      properties: {
        detected: { type: 'string' },
        shape_required: { type: 'string' },
        matched: { type: 'boolean' },
        comment_zh: { type: 'string' }
      },
      required: ['detected', 'shape_required', 'matched', 'comment_zh'],
      additionalProperties: false
    },
    earned: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          your_words: { type: 'string' },
          why_zh: { type: 'string' }
        },
        required: ['point', 'your_words', 'why_zh'],
        additionalProperties: false
      }
    },
    missed: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          section: { type: 'string' },
          direction_zh: { type: 'string' }
        },
        required: ['point', 'section', 'direction_zh'],
        additionalProperties: false
      }
    },
    generic_paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          why_zh: { type: 'string' }
        },
        required: ['quote', 'why_zh'],
        additionalProperties: false
      }
    },
    length: {
      type: 'object',
      properties: {
        words: { type: 'integer' },
        guide_words: { type: 'integer' },
        comment_zh: { type: 'string' }
      },
      required: ['words', 'guide_words', 'comment_zh'],
      additionalProperties: false
    },
    next_actions_zh: { type: 'array', items: { type: 'string' } },
    overall_zh: { type: 'string' }
  },
  required: ['score', 'out_of', 'verdict_zh', 'command_word', 'earned', 'missed',
    'generic_paragraphs', 'length', 'next_actions_zh', 'overall_zh'],
  additionalProperties: false
};

function gradeAnswer_(body) {
  var answer = String(body.answer || '').trim();
  if (answer.length < 20) return { ok: false, error: 'TOO_SHORT', message: '答案太短，貼完整一點再批改' };
  var marks = Number(body.marks || 10);
  if (!(marks > 0 && marks <= 40)) marks = 10;

  var user = [
    'SCENARIO 情境：',
    String(body.scenario || '(未提供情境)').trim(),
    '',
    'TASK 題目（' + marks + ' marks）：',
    String(body.question || '(未提供題目)').trim(),
    '',
    'LEARNER ANSWER 學員作答：',
    answer
  ].join('\n');

  var res = callClaude_({
    system: GRADE_SYSTEM,
    user: user,
    schema: GRADE_SCHEMA,
    maxTokens: 14000,
    effort: effort_('GRADE_EFFORT')
  });
  if (!res.ok) return res;

  var d = res.data;
  if (d && typeof d.out_of === 'number' && d.out_of !== marks) d.out_of = marks;
  return { ok: true, data: d, usage: res.usage, model: res.model };
}

/* ============================== Anthropic 呼叫 ============================== */

/**
 * 呼叫 Messages API 並取回 structured output。
 * 先試「帶 server-side fallback」；若該 beta 被拒（400），自動退一次為不帶 fallback 再送。
 */
function callClaude_(o) {
  var key = getProp_('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'NO_KEY', message: '後端尚未設定 ANTHROPIC_API_KEY（專案設定 → 指令碼屬性）' };

  var attempt = function (withFallback) {
    var payload = {
      model: MODEL,
      max_tokens: o.maxTokens || 12000,
      system: o.system,
      messages: [{ role: 'user', content: o.user }],
      output_config: { effort: o.effort || 'high', format: { type: 'json_schema', schema: o.schema } }
    };
    var headers = { 'x-api-key': key, 'anthropic-version': API_VERSION };
    if (withFallback) {
      payload.fallbacks = 'default';           // 婉拒時由伺服器端換模型完成同一次呼叫
      headers['anthropic-beta'] = FALLBACK_BETA;
    }
    return UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  };

  var resp = attempt(true);
  var code = resp.getResponseCode();
  var text = resp.getContentText();

  if (code === 400 && /fallback|beta/i.test(text)) {   // 該 beta 不可用 → 不帶 fallback 重送一次
    resp = attempt(false);
    code = resp.getResponseCode();
    text = resp.getContentText();
  }

  if (code !== 200) {
    var msg = text;
    try { msg = JSON.parse(text).error.message; } catch (e) {}
    console.error('Anthropic ' + code + ': ' + text.substring(0, 500));
    return { ok: false, error: 'API_' + code, message: apiHint_(code) + msg };
  }

  var body;
  try { body = JSON.parse(text); }
  catch (e) { return { ok: false, error: 'BAD_RESPONSE', message: 'API 回應不是 JSON' }; }

  if (body.stop_reason === 'refusal') {
    var cat = (body.stop_details && body.stop_details.category) || '';
    return { ok: false, error: 'REFUSAL', message: '模型婉拒了這次請求' + (cat ? '（' + cat + '）' : '') + '，請改用練習情境或調整敘述。' };
  }
  if (body.stop_reason === 'max_tokens') {
    return { ok: false, error: 'TRUNCATED', message: '輸出被長度上限截斷，請把情境或答案縮短一點再試。' };
  }

  var out = '';
  (body.content || []).forEach(function (b) { if (b.type === 'text') out += b.text; });
  var data;
  try { data = JSON.parse(out); }
  catch (e) { return { ok: false, error: 'BAD_JSON_OUT', message: '模型回傳的不是合法 JSON', raw: out.substring(0, 800) }; }

  var u = body.usage || {};
  return {
    ok: true, data: data, model: body.model,
    usage: {
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      usd: Number(((u.input_tokens || 0) / 1e6 * 5 + (u.output_tokens || 0) / 1e6 * 25).toFixed(4))
    }
  };
}

function apiHint_(code) {
  if (code === 401) return '（金鑰不對或已失效）';
  if (code === 429) return '（被限流，等一下再試）';
  if (code === 529) return '（Anthropic 忙線，稍後再試）';
  if (code >= 500) return '（Anthropic 伺服器錯誤）';
  return '';
}

/* ============================== 小工具 ============================== */

/**
 * 思考深度。Apps Script 的 UrlFetchApp 對單次請求有時間上限，effort 開太高有機會超時，
 * 所以預設 medium；覺得分析不夠深可在指令碼屬性設 ANALYSE_EFFORT / GRADE_EFFORT = high。
 */
function effort_(key) {
  var v = getProp_(key);
  return ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(v) >= 0 ? v : 'medium';
}

function getProp_(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================== 編輯器內手動測試 ============================== */

/** 在編輯器直接執行：確認金鑰有設、API 通得到、structured output 正常 */
function selfTest() {
  console.log('金鑰已設定：' + !!getProp_('ANTHROPIC_API_KEY'));
  var r = analyseScenario_({
    scenario: 'The site manager said there was nothing to worry about because it had been happening for years ' +
      'and no one had been seriously hurt. No induction was given to the two welders who started that week. ' +
      'Workers will not report near misses because they are afraid of being blamed. The risk assessment was ' +
      'done by one office engineer who has never visited the site.'
  });
  if (!r.ok) { console.error('失敗：' + r.error + ' — ' + r.message); return; }
  console.log('命中章節：' + r.data.hits.map(function (h) { return h.section; }).join(', '));
  console.log('可能題目數：' + r.data.likely_tasks.length);
  console.log('用量：in ' + r.usage.input + ' / out ' + r.usage.output + ' tokens ≈ US$' + r.usage.usd);
  console.log('第一條命中：' + JSON.stringify(r.data.hits[0], null, 2));
}
