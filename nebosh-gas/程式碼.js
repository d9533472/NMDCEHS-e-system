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
  /**
   * GET 退路：瀏覽器跟著轉址時會把 POST 改成 GET（被快取住的 301 最常見），
   * 這條路讓筆記頁的「章節論述」在那種情況下還是通得過去。
   *   /exec?action=argue&p=<encodeURIComponent(JSON)>
   * 只開放筆記頁用的 argue / drill：內容塞得進網址；analyse / grade / translate 一律還是走 POST。
   */
  if ((p.action === 'argue' || p.action === 'drill') && p.p) {
    var b;
    try { b = JSON.parse(p.p); }
    catch (err) { return json_({ ok: false, error: 'BAD_JSON', message: 'p 參數不是合法 JSON' }); }
    var need = getProp_('SHARED_SECRET');
    if (need && String(b.secret || '') !== String(need)) {
      return json_({ ok: false, error: 'FORBIDDEN', message: '通關密語不符，請檢查設定' });
    }
    return json_(p.action === 'drill' ? drillSentences_(b) : argueTopic_(b));
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
      case 'analyse':   return json_(analyseScenario_(body));
      case 'translate': return json_(translateScenario_(body));
      case 'grade':   return json_(gradeAnswer_(body));
      case 'check':   return json_(checkSentence_(body));
      case 'argue':   return json_(argueTopic_(body));
      case 'drill':   return json_(drillSentences_(body));
      case 'ping':    return json_(ping_());
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
  '5. Chinese fields are for comprehension only and should be short. Write ALL Chinese in Traditional Chinese (繁體中文, Taiwan usage) — never Simplified.',
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

/* ============================== 動作 4：情境逐句中文對照 ==============================
   前端已經把情境切成一句一條(和「標註版情境」用同一套切法),這裡只負責逐句翻譯:
   不重新斷句、不合併、不增刪 —— 編號一一對應,前端點中文那一句才找得到對應的英文。 */

var TRANSLATE_SYSTEM = [
  'You translate a NEBOSH IG1 open-book exam scenario into Traditional Chinese for a Taiwanese learner who is about to answer questions on it.',
  '',
  'The scenario arrives ALREADY SPLIT into numbered sentences. Translate EACH numbered sentence and return EXACTLY one item per',
  'number, in the same order, with the same numbers. Never merge two sentences into one item, never split one into two, never skip',
  'one, never invent one that was not in the input. The learner clicks a Chinese line to jump to that English line — if the numbering',
  'drifts, the whole feature breaks.',
  '',
  'How to translate:',
  '· Traditional Chinese (繁體中文, Taiwan usage) — never Simplified, never mainland vocabulary.',
  '· Translate what the sentence SAYS. Do not explain it, do not add facts, do not draw a conclusion the English does not state, and',
  '  do not hint at what the examiner is looking for. This is a reading aid, not analysis.',
  '· Keep every number, date, quantity, job title, proper name and standard reference exactly as written in the English.',
  '· For a health-and-safety term of art, give the Chinese then the English in brackets on its first appearance in that sentence,',
  '  e.g. 「安全作業許可（permit to work）」「風險評估（risk assessment）」「近失事件（near miss）」.',
  '· Where the English is vague, hedged or ambiguous, translate it just as vaguely. Do NOT resolve the ambiguity — in this exam the',
  '  ambiguity is often exactly where the marks are, and a tidied-up translation hides it.',
  '· Keep each item to the one sentence it came from. No commentary, no bullet points, no section references.',
  '',
  'terms: the 5-15 words or phrases in THIS scenario a Taiwanese learner is most likely to misread — false friends, legal terms of',
  'art, and ordinary English words carrying a technical meaning here. For each give the English, the Chinese, and one short Chinese',
  'line saying what it actually means in this context and what it is easy to mistake it for. Never use this field to suggest answers.'
].join('\n');

var TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, zh: { type: 'string' } },
        required: ['n', 'zh'],
        additionalProperties: false
      }
    },
    terms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { en: { type: 'string' }, zh: { type: 'string' }, note_zh: { type: 'string' } },
        required: ['en', 'zh', 'note_zh'],
        additionalProperties: false
      }
    }
  },
  required: ['items', 'terms'],
  additionalProperties: false
};

function translateScenario_(body) {
  var list = body.sentences;
  if (!list || !list.length) return { ok: false, error: 'NO_SENTENCES', message: '沒有收到要翻譯的句子' };
  if (list.length > 120) return { ok: false, error: 'TOO_MANY', message: '句子太多（' + list.length + ' 句），一次最多 120 句' };

  var lines = [], chars = 0;
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i] == null ? '' : list[i]).trim();
    chars += s.length;
    lines.push((i + 1) + '. ' + s);
  }
  if (chars < 30) return { ok: false, error: 'TOO_SHORT', message: '情境太短，至少貼 30 個字元' };
  if (chars > 20000) return { ok: false, error: 'TOO_LONG', message: '情境太長（' + chars + ' 字元），分段貼' };

  var res = callClaude_({
    system: TRANSLATE_SYSTEM,
    user: 'Translate these ' + list.length + ' numbered sentences. Return exactly ' + list.length +
          ' items, numbered 1 to ' + list.length + '.\n\n' + lines.join('\n'),
    schema: TRANSLATE_SCHEMA,
    maxTokens: 16000,
    effort: effort_('TRANSLATE_EFFORT')
  });
  if (!res.ok) return res;

  /* 保險:依編號對回原本的順序,缺的補空字串、多的丟掉。前端是靠索引對位的,寧可缺一句也不能整排錯位。 */
  var byN = {};
  (res.data.items || []).forEach(function (x) { byN[Number(x.n)] = String(x.zh || ''); });
  var items = [], miss = 0;
  for (var k = 1; k <= list.length; k++) {
    var zh = byN[k] || '';
    if (!zh) miss++;
    items.push({ n: k, zh: zh });
  }
  res.data.items = items;
  res.data.missing = miss;

  return { ok: true, data: res.data, usage: res.usage, model: res.model };
}

/* ============================== 動作 3：單句四步檢查 ==============================
   給骨架產生器用：學員照骨架寫完一句之後，只檢查「該跑的步驟有沒有跑到」。
   刻意做得比 grade 輕（單句、不給分數、不寫範句），回應才會快。 */

var CHECK_SYSTEM = [
  'You are a NEBOSH IG1 tutor checking ONE practice sentence (or short paragraph) a learner just wrote.',
  'You are NOT marking a whole answer and you do NOT give a score. You check one thing: does the sentence do the moves it is supposed to do?',
  '',
  'The four moves:',
  '1 QUOTE — it points at a specific fact that exists in THIS scenario (a named condition, person, object or failing).',
  '2 LINK — it names the concept, standard, duty or legal/organisational requirement that fact relates to.',
  '3 CONSEQUENCE — it carries the causation forward: who could be harmed / what could go wrong, and why this fact makes it likely.',
  '4 ACTION — it states a specific action: who does what, by when, and for what purpose.',
  '',
  'You are told which moves the command word REQUIRES. Judge each required move as present or missing.',
  'A move counts as present only if a marker could actually see it in the words written — not if it is merely implied.',
  '',
  'Rules:',
  '· For each move you judge present, quote the learner\'s exact words that carry it (short fragment, English).',
  '· For each move missing, say in one Chinese line WHAT IS MISSING and WHAT KIND OF THING would fill it.',
  '  NEVER write the replacement words, the corrected sentence, or a phrase they could paste in. Direction only.',
  '· Moves that are NOT required by the command word: set required=false and do not complain about their absence.',
  '  If the learner wrote an extra move that the command word does not want, say so — in the exam that wastes time and can cost marks.',
  '· If scenario_only is true, a sentence that would work for any other company is worth nothing: say so plainly.',
  '· Roughly 25-35 English words is one mark\'s worth. Flag it if clearly short or clearly bloated.',
  '· Chinese fields: Traditional Chinese (繁體中文, Taiwan usage) — never Simplified. Plain and direct, no flattery, no praise padding.',
  '· If the text is empty, off-topic, or copied boilerplate, say that instead of inventing a judgement.',
  '',
  'This is practice. Never produce a submittable sentence.'
].join('\n');

var CHECK_SCHEMA = {
  type: 'object',
  properties: {
    verdict_zh: { type: 'string' },
    ready: { type: 'boolean' },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          move: { type: 'integer' },
          required: { type: 'boolean' },
          present: { type: 'boolean' },
          evidence: { type: 'string' },
          issue_zh: { type: 'string' }
        },
        required: ['move', 'required', 'present', 'evidence', 'issue_zh'],
        additionalProperties: false
      }
    },
    scenario_anchored: { type: 'boolean' },
    generic_risk_zh: { type: 'string' },
    word_count: { type: 'integer' },
    length_zh: { type: 'string' },
    next_zh: { type: 'string' }
  },
  required: ['verdict_zh', 'ready', 'moves', 'scenario_anchored', 'generic_risk_zh', 'word_count', 'length_zh', 'next_zh'],
  additionalProperties: false
};

var MOVE_NAME = { 1: 'QUOTE', 2: 'LINK', 3: 'CONSEQUENCE', 4: 'ACTION' };

function checkSentence_(body) {
  var sent = String(body.sentence || '').trim();
  if (sent.length < 15) return { ok: false, error: 'TOO_SHORT', message: '先寫一句再檢查（至少 15 個字元）' };

  var moves = (body.moves && body.moves.length) ? body.moves : [1, 2, 3];
  var required = moves.map(function (m) { return m + ' ' + (MOVE_NAME[m] || '?'); }).join(', ');

  var user = [
    'SCENARIO 情境：',
    String(body.scenario || '(未提供情境 — 就無法判斷這句有沒有扣住情境事實，請在 scenario_anchored 說明)').trim(),
    '',
    'COMMAND WORD 命令詞：' + String(body.command || '(未提供)'),
    'SHAPE 要求的形狀：' + String(body.shape || '(未提供)'),
    'REQUIRED MOVES 這個命令詞要跑的步驟：' + required,
    'BASED ON THE SCENARIO ONLY：' + (body.only ? 'yes' : 'no'),
    body.topic ? ('TARGET CONCEPT 學員想連到的觀念：' + String(body.topic)) : '',
    '',
    'LEARNER SENTENCE 學員寫的這一句：',
    sent
  ].filter(function (x) { return x !== ''; }).join('\n');

  var res = callClaude_({
    system: CHECK_SYSTEM,
    user: user,
    schema: CHECK_SCHEMA,
    maxTokens: 6000,
    effort: effort_('CHECK_EFFORT')
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
  '6. Walk through the learner\'s OWN numbered points one by one, in their order, in per_point.',
  '',
  'per_point — the learner writes their answer as a numbered list (1. 2. 3. … , or 1) / 1、 / ① , or one point',
  'per paragraph or per line when they did not number it). Produce ONE entry for EVERY point they wrote, in the',
  'order they wrote it, with no gaps and none merged together — if they wrote 7 points, return 7 entries.',
  '· n            = their own number (1, 2, 3 …). If they did not number, number their points yourself in order.',
  '· your_words   = a short verbatim extract of THAT point (the first clause is enough, do not paraphrase, do not improve).',
  '· verdict      = "scored" (it earns a mark) / "partial" (on the right track but under-developed, or it duplicates',
  '                 a point already credited earlier, so it adds nothing) / "no" (earns nothing).',
  '· marks_awarded= how many marks THIS point earned (0, 0.5 or 1; use 1 only when it is a clean mark).',
  '· mark_point   = the examiner mark-scheme point it maps to, in English. Empty string when it maps to nothing.',
  '· why_zh       = why it scored, or precisely why it did not — name the actual defect: 泛論沒扣情境 / 只有觀念沒有因果 /',
  '                 命令詞形狀不對（例如題目要 Outline 卻只寫了名詞）/ 與第 N 點重複同一個事實 / 寫成建議但題目沒有要建議.',
  '· fix_zh       = for "partial" and "no" only: what to do with THAT sentence — which scenario fact to attach, or which',
  '                 step (① QUOTE / ② LINK / ③ CONSEQUENCE / ④ ACTION) is missing. Direction only, never a written-out',
  '                 sentence they could copy. Leave it as an empty string when verdict is "scored".',
  'The marks_awarded in per_point must add up to score. earned/missed stay as they are — per_point is the learner-side',
  'view of the same marking, earned/missed is the mark-scheme-side view.',
  '',
  'Hard rules:',
  '· NEVER write a model answer, a rewritten paragraph, or a sentence the learner could submit. Feedback and direction only.',
  '  If asked to, refuse in the overall_zh field and mark it clearly.',
  '· Quote the learner exactly when quoting; do not paraphrase into a better version.',
  '· Chinese fields: plain, direct, no flattery, and always Traditional Chinese (繁體中文, Taiwan usage) — never Simplified. English fields: exam register.',
  '· If the answer is empty or irrelevant, score 0 and say so.',
  '',
  'ai_style — a SEPARATE, SECONDARY judgement: how much of this answer reads as if it was written by an AI.',
  'This is a style inference from the text alone. It is NOT forensic proof and it MUST NOT change the score by',
  'even half a mark — mark the content first, then judge the writing voice independently.',
  'Why it matters: NEBOSH open-book answers that read as machine-written get referred to malpractice, and the',
  'closing interview asks the learner to account for their own words. So the learner needs to know which of their',
  'sentences would make an examiner suspicious — including sentences they wrote themselves.',
  'Lean AI (push likelihood up):',
  '· Scaffolding phrases: "It is important to note that", "Furthermore", "Moreover", "In conclusion",',
  '  "This ensures that", "plays a crucial role", "a holistic approach", "robust framework".',
  '· Suspiciously even rhythm: every numbered point the same length, the same clause shape, the same tricolon.',
  '· Fluent, polished, textbook-correct prose that carries NO fact from this scenario (note: this overlaps with',
  '  generic_paragraphs — the same sentence can be both 0 marks and AI-sounding, and that is worth saying).',
  '· No typos, no self-corrections, no uneven register, no non-native slips anywhere across a long answer.',
  '· Terminology, standards or legal duties that the scenario never mentions, dropped in confidently but vaguely.',
  '· A sudden jump in English quality between one paragraph and the next.',
  'Lean human (push likelihood down):',
  '· Specific scenario facts named exactly: people, numbers, dates, locations, equipment from THIS scenario.',
  '· Non-native article/preposition/tense slips, inconsistent punctuation, abbreviations, shorthand.',
  '· Uneven development — one point fat, the next thin; a point abandoned mid-thought.',
  '· Idiosyncratic ordering or a personal angle an examiner would not find in a textbook.',
  'Fields:',
  '· likelihood = integer 0-100, the share of this answer that reads as machine-written. Use the whole range;',
  '               do not default to 50. 0-25 = reads as the learner, 26-60 = mixed or edited, 61-100 = reads as AI.',
  '· band       = "human" (likelihood <= 25) / "mixed" (26-60) / "ai" (>= 61). Must agree with likelihood.',
  '· confidence = "low" when the answer is short or the signals are weak, "high" only when the signals are many',
  '               and consistent. Short answers (under ~80 words) can almost never be better than "low".',
  '· signals       = the AI-leaning evidence, each a VERBATIM quote plus why_zh naming the feature. Empty array if none.',
  '· human_signals = the human-leaning evidence, same shape. Empty array if none.',
  '· comment_zh      = two or three sentences: the verdict, and that this is a style read, not evidence.',
  '· interview_risk_zh = what the closing interview would most likely press on in THIS answer, and what the learner',
  '                      would need to be able to explain out loud. Direction only — never a script to recite.'
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
    per_point: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          your_words: { type: 'string' },
          verdict: { type: 'string', enum: ['scored', 'partial', 'no'] },
          marks_awarded: { type: 'number' },
          mark_point: { type: 'string' },
          why_zh: { type: 'string' },
          fix_zh: { type: 'string' }
        },
        required: ['n', 'your_words', 'verdict', 'marks_awarded', 'mark_point', 'why_zh', 'fix_zh'],
        additionalProperties: false
      }
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
    ai_style: {
      type: 'object',
      properties: {
        likelihood: { type: 'integer' },
        band: { type: 'string', enum: ['human', 'mixed', 'ai'] },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        signals: {
          type: 'array',
          items: {
            type: 'object',
            properties: { quote: { type: 'string' }, why_zh: { type: 'string' } },
            required: ['quote', 'why_zh'],
            additionalProperties: false
          }
        },
        human_signals: {
          type: 'array',
          items: {
            type: 'object',
            properties: { quote: { type: 'string' }, why_zh: { type: 'string' } },
            required: ['quote', 'why_zh'],
            additionalProperties: false
          }
        },
        comment_zh: { type: 'string' },
        interview_risk_zh: { type: 'string' }
      },
      required: ['likelihood', 'band', 'confidence', 'signals', 'human_signals', 'comment_zh', 'interview_risk_zh'],
      additionalProperties: false
    },
    next_actions_zh: { type: 'array', items: { type: 'string' } },
    overall_zh: { type: 'string' }
  },
  required: ['score', 'out_of', 'verdict_zh', 'command_word', 'per_point', 'earned', 'missed',
    'generic_paragraphs', 'length', 'ai_style', 'next_actions_zh', 'overall_zh'],
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
    'LEARNER ANSWER 學員作答（學員習慣用 1. 2. 3. … 逐點作答，per_point 要照這個編號一條一條回）：',
    answer
  ].join('\n');

  var res = callClaude_({
    system: GRADE_SYSTEM,
    user: user,
    schema: GRADE_SCHEMA,
    maxTokens: 20000,  // 16000 → 20000：多了 ai_style 一段，長卷容易撞到 max_tokens 被截斷
    effort: effort_('GRADE_EFFORT')
  });
  if (!res.ok) return res;

  var d = res.data;
  if (d && typeof d.out_of === 'number' && d.out_of !== marks) d.out_of = marks;
  // AI 筆跡：把 likelihood 夾回 0-100，並讓 band 一定和數字一致（模型偶爾會給不一致的組合）
  if (d && d.ai_style) {
    var a = d.ai_style;
    var p = Math.round(Number(a.likelihood));
    if (!isFinite(p)) p = 0;
    a.likelihood = Math.max(0, Math.min(100, p));
    a.band = a.likelihood >= 61 ? 'ai' : (a.likelihood >= 26 ? 'mixed' : 'human');
    if (answer.split(/\s+/).length < 80 && a.confidence === 'high') a.confidence = 'medium';
  }
  return { ok: true, data: d, usage: res.usage, model: res.model };
}

/* ============================== 筆記頁共用：章節對照表 ==============================
   取自使用者自己那份完整筆記的 19 個 <h2>。沒給這張表時模型會自己猜編號
   （實測把「安全文化」寫成 1.3，他的筆記裡是 3.1），所以 argue / drill 都要帶上。 */
var ELEMENTS = [
  'The learner\'s own note set uses exactly these 19 elements. When you cite a section, use THIS numbering and nothing else:',
  '1.1 Moral and money | 1.2 Regulating health and safety | 1.3 Health and safety duties of leaders, managers, directors, supervisors | 1.4 Managing contractors',
  '2.1 Health and safety management systems | 2.2 Health and safety policy',
  '3.1 Health and safety culture | 3.2 Improving health and safety culture | 3.3 Human factors | 3.4A Assessing risk | 3.4B Safety signs and PPE',
  '3.5 Managing change | 3.6 Safe system of work (SSW) | 3.7 Permit-to-work system | 3.8 Emergency procedures and first aid',
  '4.1 Investigating incidents | 4.2 Monitoring health and safety performance | 4.3 Auditing | 4.4 Reviewing health and safety performance'
].join('\n');

/* ============================== 動作 4：單一筆記項目的論述 ==============================
   給筆記頁用：學員在筆記裡點某一個點（1.1 的 Moral、3.4 的 ERIC SP…），
   要的不是翻譯，是「這個點能怎麼論述、怎麼寫成得分句、會被怎麼問」。
   有帶情境時（從練習頁傳過來）就把論述扣在情境事實上。 */

var ARGUE_SYSTEM = [
  'You are an experienced NEBOSH International General Certificate (IG1) tutor. A learner is revising with their own',
  'note set and has clicked ONE point in it. Your job is to turn that one point into an argument they can use in the exam.',
  '',
  'You are given the element number (e.g. 1.1), the element title, the sub-heading the point sits under, and the exact',
  'note text of the point. Sometimes you are also given the practice scenario the learner is currently working on.',
  '',
  'What to produce:',
  '1 WHAT IT IS — the point stated the way an examiner states it, in standard IG1 terminology, including the',
  '  ILO instrument or standard it belongs to when the point genuinely has one.',
  '2 WHY IT EARNS A MARK — what the marker is looking for here, and what separates a mark-earning treatment',
  '  from merely naming the thing.',
  '3 THE ARGUMENT — 3 to 5 lines that actually develop the point: the causation behind it, the duty or principle it',
  '  rests on, and the objection a manager would raise together with the answer to it. This is the part the learner',
  '  will argue from, so make it substantive. Do not restate the note text in other words.',
  '4 MODEL SENTENCE SKELETONS — 2 to 4 sentences in the shape a mark-earning sentence takes on this point.',
  '5 PITFALLS — the generic sentences learners really do write on this point that score nothing, why they score',
  '  nothing, and the direction to fix them.',
  '6 HOW IT IS ASKED — the command words that bring this point up, typical task wording, the usual mark',
  '  allocation, and the shape that command word demands.',
  '7 RELATED SECTIONS — the other elements (1.1 to 4.4) that have to be written alongside this point.',
  '',
  'Hard rules:',
  '· Every model sentence MUST contain at least one bracketed gap [ ... ] where a fact from the learner\'s own',
  '  scenario has to go. Never write a complete sentence that could be submitted as it stands. This is a revision',
  '  aid, not an answer.',
  '· Pitfall fixes are DIRECTION only: name what kind of thing is missing. Never write the replacement words.',
  '· If a scenario is supplied, anchor the argument and the gaps to facts that are actually in it, quote those facts,',
  '  and set scenario_anchored true. If none is supplied, keep the gaps generic and set it false.',
  '· Work from the IG1 syllabus only. Do not invent legal instruments, figures or statistics. If you are not sure a',
  '  number belongs to this point, leave it out.',
  '· Chinese fields: Traditional Chinese (繁體中文, Taiwan usage) — never Simplified. Plain and direct, no praise padding.',
  '· English fields: the examiner\'s own vocabulary, no padding.',
  '· If the note text is too fragmentary to argue from (a bare label or a single table cell), say so in note_zh and',
  '  still give the best treatment of the concept that label points at.',
  '',
  ELEMENTS,
  '',
  'This is practice. Never produce a submittable sentence.'
].join('\n');

var ARGUE_SCHEMA = {
  type: 'object',
  properties: {
    section: { type: 'string' },
    title_en: { type: 'string' },
    title_zh: { type: 'string' },
    what_en: { type: 'string' },
    what_zh: { type: 'string' },
    why_marks_zh: { type: 'string' },
    argument: {
      type: 'array',
      items: {
        type: 'object',
        properties: { line_en: { type: 'string' }, line_zh: { type: 'string' } },
        required: ['line_en', 'line_zh'],
        additionalProperties: false
      }
    },
    model_sentences: {
      type: 'array',
      items: {
        type: 'object',
        properties: { en: { type: 'string' }, zh: { type: 'string' }, marks: { type: 'integer' } },
        required: ['en', 'zh', 'marks'],
        additionalProperties: false
      }
    },
    pitfalls: {
      type: 'array',
      items: {
        type: 'object',
        properties: { generic_en: { type: 'string' }, why_zh: { type: 'string' }, direction_zh: { type: 'string' } },
        required: ['generic_en', 'why_zh', 'direction_zh'],
        additionalProperties: false
      }
    },
    asked_as: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          command_word: { type: 'string' },
          wording: { type: 'string' },
          marks: { type: 'string' },
          shape_zh: { type: 'string' }
        },
        required: ['command_word', 'wording', 'marks', 'shape_zh'],
        additionalProperties: false
      }
    },
    related: {
      type: 'array',
      items: {
        type: 'object',
        properties: { section: { type: 'string' }, why_zh: { type: 'string' } },
        required: ['section', 'why_zh'],
        additionalProperties: false
      }
    },
    scenario_anchored: { type: 'boolean' },
    note_zh: { type: 'string' }
  },
  required: ['section', 'title_en', 'title_zh', 'what_en', 'what_zh', 'why_marks_zh', 'argument',
             'model_sentences', 'pitfalls', 'asked_as', 'related', 'scenario_anchored', 'note_zh'],
  additionalProperties: false
};

function argueTopic_(body) {
  var item = String(body.item || '').trim();
  if (item.length < 3) return { ok: false, error: 'TOO_SHORT', message: '沒有收到要論述的項目文字' };

  var sc = String(body.scenario || '').trim();
  var user = [
    'ELEMENT 章節：' + String(body.section || '(未提供)') + '　' + String(body.section_title || ''),
    body.heading ? ('SUB-HEADING 這個點所在的小節：' + String(body.heading)) : '',
    '',
    'THE POINT THE LEARNER CLICKED 學員點的這個點（原筆記文字，英文主、中文小字輔）：',
    item,
    '',
    sc
      ? ('PRACTICE SCENARIO 他目前在練的情境 — 把論述與 [ ] 空位扣在這些事實上：\n' + sc)
      : 'NO SCENARIO SUPPLIED — keep the bracketed gaps generic and set scenario_anchored to false.'
  ].filter(function (x) { return x !== ''; }).join('\n');

  var res = callClaude_({
    system: ARGUE_SYSTEM,
    user: user,
    schema: ARGUE_SCHEMA,
    maxTokens: 12000,
    effort: effort_('ARGUE_EFFORT')
  });
  if (!res.ok) return res;

  var d = res.data;
  // 章節編號以前端傳來的為準：模型偶爾會把 3.4B 寫成 3.4
  if (d && body.section) d.section = String(body.section);
  // 範例句一定要留空位，不然就是一句可以直接交的答案 — 標記出來讓前端警告
  if (d && d.model_sentences) {
    d.model_sentences.forEach(function (s) {
      s.has_gap = /\[[^\]]*\]/.test(String(s.en || ''));
      var m = Math.round(Number(s.marks));
      s.marks = isFinite(m) ? Math.max(1, Math.min(10, m)) : 1;
    });
  }
  return { ok: true, data: d, usage: res.usage, model: res.model };
}

/* ============================== 動作 5：句子練習（預設 50 句，分批） ==============================
   流程是：情境貼在練習模式頁 → 回筆記頁點一個關鍵字 → 在抽屜貼上題目 → 出一整組句子。
   所以這裡同時拿到三樣東西：情境、題目（命令詞＋配分）、他剛點的那個筆記點。
   和 argue 一樣：每一句都必須留 [ ] 空位，不給可以直接交的句子。

   50 句不走單一請求：一次要 50 句會讓 UrlFetchApp 跑近三分鐘，而且模型到後段
   會開始改寫前面講過的點。改成前端送兩批、每批 25 句，第二批把第一批的
   point_zh 當 exclude 清單送回來 — 既避開逾時，也真的擋掉重複。
   body.want = 這一批要幾句（預設 15，相容舊版前端）；body.exclude = 已經寫過的點。 */

var DRILL_SYSTEM = [
  'You are a NEBOSH IG1 tutor building a SENTENCE DRILL SET for a learner who is revising. They are not sitting the',
  'exam right now: this is practice material they will write over in their own words.',
  '',
  'You are given three things: the practice scenario, the exam task (command word and marks), and the specific note',
  'point the learner has just clicked in their own notes.',
  '',
  'How IG1 is marked — apply this literally:',
  '· One mark = one technical point, demonstrated AND tied to a fact that exists only in THIS scenario.',
  '· The command word sets the shape. Identify / Give = name it plus context. Outline = name it plus a brief',
  '  description. Describe = a detailed factual account. Explain = visible causation (because / so that / which means).',
  '  Comment on / Assess / Evaluate = a judgement on adequacy supported by evidence. Justify = reasons for a decision.',
  '  Recommend / Suggest = a specific action with detail, purpose, owner and timescale.',
  '· Roughly 30 words per mark. The same point written twice in different words scores once.',
  '',
  'Build the set like this:',
  '1 Produce AT LEAST the number of sentences the user message asks for. Every one is a DIFFERENT mark-earning',
  '  point — never a paraphrase of another one, and never the same control written once broadly and once narrowly.',
  '  Large sets are reached by changing the ANGLE, not by splitting one point into slices. Work systematically',
  '  through: each distinct hazard in the scenario; each level of the control hierarchy for the main hazards;',
  '  each duty holder (employer, manager, supervisor, worker, contractor, enforcing authority, client);',
  '  each stage of the work (planning, selection, induction, during work, end of shift, emergency, review);',
  '  each group at risk (workers, contractors, visitors, public, vulnerable persons); each consequence type',
  '  (injury, ill health, legal, financial, reputational); and the management arrangements (policy, risk',
  '  assessment, training, supervision, consultation, PTW, inspection, monitoring, investigation, review).',
  '  Before writing each sentence, check it against every sentence already written in this response: if a marker',
  '  would score the two as the same point, drop it and move to a different angle instead.',
  '2 Start from the clicked point: roughly the first fifth of the set develops it. Then widen to the other points this',
  '  task actually requires, and name the element each one comes from (1.1 to 4.4).',
  '3 EVERY sentence must contain at least one bracketed gap [ ... ] that names the KIND of scenario fact which goes',
  '  there, pointing at something that really is in the scenario. Never write a sentence that could be submitted as it',
  '  stands — this is a drill, not an answer.',
  '4 Tag each sentence with the four-step moves it runs:',
  '  1 QUOTE — points at a specific fact in this scenario. 2 LINK — names the concept, duty or standard.',
  '  3 CONSEQUENCE — carries causation forward: who could be harmed and why this fact makes it likely.',
  '  4 ACTION — who does what, by when, for what purpose.',
  '5 Most sentences take the shape the task\'s command word demands. Also include 3 or 4 clearly labelled VARIANTS:',
  '  the same point reshaped for a different command word, so the learner can see how the shape changes. Set the',
  '  shape field to the command word that sentence is built for, so variants are obvious.',
  '6 In missing_zh, name what this task needs that the clicked note point does not cover, and which section to read.',
  '7 In check_zh, give the learner 3 to 5 things to check in their own writing for THIS task.',
  '',
  'IF NO CLICKED NOTE POINT IS SUPPLIED — the learner does not know which element this task belongs to:',
  '· Work it out yourself from the task wording and the scenario, using the element list below. Normally a task draws',
  '  on two to four elements; say which, and why, in the first sentence of coverage_zh.',
  '· Then spread the sentences across those elements in proportion to the marks each is likely to carry, and set the',
  '  section field on every sentence so the learner can see where each point came from and go and read it.',
  '· In missing_zh, name the elements they should open in their notes before writing, in the order to read them.',
  '· Everything else — the gaps, the move tags, the shape variants, the sentence count — is unchanged.',
  '',
  'IF THE USER MESSAGE CARRIES AN "ALREADY COVERED" LIST — this call is the later half of one larger set:',
  '· Every point on that list is already written and already scored. Do NOT repeat any of them, and do NOT write',
  '  a synonym, a narrower version, or a broader version of the same control. Treat that ground as exhausted.',
  '· Skip rule 2 — the clicked note point has already been developed in the earlier half. Go straight to the',
  '  angles the list has not reached, working down the checklist in rule 1 and taking the ones still untouched.',
  '· Keep the same quality bar: same gaps, same move tags, same 25-35 words, same element tagging.',
  '· In coverage_zh, say in one sentence which new angles this half adds.',
  '',
  'Hard rules:',
  '· Work from the IG1 syllabus and the scenario given. Do not invent facts, legal instruments or figures.',
  '· If the task text does not contain a recognisable command word or mark allocation, say so in shape_zh and',
  '  build the set for the most likely command word rather than refusing.',
  '· Chinese fields: Traditional Chinese (繁體中文, Taiwan usage) — never Simplified. Plain and direct, no praise padding.',
  '· English sentences: the examiner\'s own vocabulary, no padding, roughly 25-35 words each.',
  '',
  ELEMENTS,
  '',
  'This is practice. Never produce a submittable sentence.'
].join('\n');

var DRILL_SCHEMA = {
  type: 'object',
  properties: {
    command_word: { type: 'string' },
    marks: { type: 'string' },
    shape_zh: { type: 'string' },
    coverage_zh: { type: 'string' },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          en: { type: 'string' },
          zh: { type: 'string' },
          shape: { type: 'string' },
          moves: { type: 'array', items: { type: 'integer' } },
          marks: { type: 'integer' },
          section: { type: 'string' },
          point_zh: { type: 'string' }
        },
        required: ['n', 'en', 'zh', 'shape', 'moves', 'marks', 'section', 'point_zh'],
        additionalProperties: false
      }
    },
    missing_zh: { type: 'array', items: { type: 'string' } },
    check_zh: { type: 'array', items: { type: 'string' } }
  },
  required: ['command_word', 'marks', 'shape_zh', 'coverage_zh', 'sentences', 'missing_zh', 'check_zh'],
  additionalProperties: false
};

function drillSentences_(body) {
  var q = String(body.question || '').trim();
  if (q.length < 10) return { ok: false, error: 'NO_TASK', message: '先把題目原文貼上來（含命令詞與配分）' };
  var item = String(body.item || '').trim();
  var sc = String(body.scenario || '').trim();

  /* 這一批要幾句。舊版前端不送 want，維持 15 不變。 */
  var want = Math.round(Number(body.want));
  want = isFinite(want) ? Math.max(5, Math.min(60, want)) : 15;

  /* 前一批已經寫掉的點（point_zh），用來擋重複 */
  var ex = (Array.isArray(body.exclude) ? body.exclude : [])
    .map(function (x) { return String(x == null ? '' : x).trim(); })
    .filter(function (x) { return x; })
    .slice(0, 80);

  var user = [
    'SCENARIO 情境：',
    sc || '(未提供情境 — 空位就寫「這裡要填情境裡的哪一種事實」，並在 coverage_zh 提醒他先去練習模式頁貼情境)',
    '',
    'EXAM TASK 題目原文（命令詞與配分就在裡面）：',
    q,
    body.marks ? ('MARKS 學員另外填的配分：' + String(body.marks)) : '',
    '',
    item
      ? ('THE NOTE POINT THE LEARNER CLICKED 他剛在筆記點的那個點：\n' +
         'ELEMENT ' + String(body.section || '(未提供)') + '　' + String(body.section_title || '') + '\n' +
         (body.heading ? ('SUB-HEADING：' + String(body.heading) + '\n') : '') +
         item)
      : 'NO NOTE POINT SUPPLIED — 學員不知道這題屬於哪一節。請你自己判斷它落在哪幾個 element，並照「IF NO CLICKED NOTE POINT IS SUPPLIED」那段處理。',
    '',
    ex.length
      ? ('ALREADY COVERED 這一組的前半已經寫過下面這些點 — 一句都不准重複、不准換句話說、不准寫同一個控制的粗細版本：\n' +
         ex.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n'))
      : '',
    (ex.length
      ? ('Produce at least ' + want + ' FURTHER drill sentences, every one on an angle the ALREADY COVERED list has not reached.')
      : (item
          ? ('Produce at least ' + want + ' drill sentences. Start from the clicked point, then cover what the task requires.')
          : ('Produce at least ' + want + ' drill sentences, spread across the elements this task actually draws on.')))
  ].filter(function (x) { return x !== '' && x !== null; }).join('\n');

  var res = callClaude_({
    system: DRILL_SYSTEM,
    user: user,
    schema: DRILL_SCHEMA,
    maxTokens: 32000,
    effort: effort_('DRILL_EFFORT')
  });
  if (!res.ok) return res;

  var d = res.data;
  if (d && d.sentences) {
    d.sentences.forEach(function (s, i) {
      s.n = i + 1;                                   // 編號以實際順序為準，模型偶爾會跳號
      s.has_gap = /\[[^\]]*\]/.test(String(s.en || ''));
      var m = Math.round(Number(s.marks));
      s.marks = isFinite(m) ? Math.max(1, Math.min(10, m)) : 1;
      s.words = String(s.en || '').split(/\s+/).filter(function (w) { return w; }).length;
      if (body.section && !String(s.section || '').trim()) s.section = String(body.section);
    });
    d.count = d.sentences.length;
    d.want = want;
    d.short = d.count < want;                        // 不足就讓前端說出來，不要默默少給
  }
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

  // 該 beta 不可用 → 不帶 fallback 重送一次。
  // 原本只認 400，但 beta 被拒也可能以 5xx 出現，所以 5xx 一併退一次再說。
  if ((code === 400 && /fallback|beta/i.test(text)) || code >= 500) {
    var retry = attempt(false);
    if (retry.getResponseCode() === 200 || code >= 500) {
      resp = retry;
      code = resp.getResponseCode();
      text = resp.getContentText();
    }
  }

  if (code !== 200) {
    var msg = text;
    try { msg = JSON.parse(text).error.message; } catch (e) {}
    console.error('Anthropic ' + code + ': ' + text.substring(0, 500));
    return { ok: false, error: 'API_' + code, message: apiHint_(code, msg) + msg };
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

function apiHint_(code, msg) {
  // 金鑰被拒時 Anthropic 有時回 503 而不是 401，訊息是 credential validation failed，
  // 照 code 分類會誤報成「伺服器錯誤」，所以先看訊息。
  // 注意：5xx + credential 訊息在 Anthropic 認證服務故障時也會出現（2026-09-29 實際遇過一次），
  // 不一定是金鑰壞掉，所以先叫人去看狀態頁，不要急著換金鑰或買額度。
  if (isCredentialError_(code, msg)) {
    return code >= 500
      ? '（憑證驗證失敗，但這是 5xx：先看 status.claude.com 是不是正在故障；沒有故障再去 Console 檢查金鑰與額度）'
      : '（金鑰被拒絕：請到 Console 確認金鑰還有效、帳戶有額度，再把新金鑰填回指令碼屬性 ANTHROPIC_API_KEY）';
  }
  if (code === 401) return '（金鑰不對或已失效）';
  if (code === 403) return '（這把金鑰沒有權限用這個模型）';
  if (code === 429) return '（被限流，等一下再試）';
  if (code === 529) return '（Anthropic 忙線，稍後再試）';
  if (code >= 500) return '（Anthropic 伺服器錯誤）';
  return '';
}

function isCredentialError_(code, msg) {
  if (code === 401 || code === 403) return true;
  return /credential|authentication|invalid x-api-key|api key/i.test(String(msg || ''));
}

/**
 * 連線測試：真的打一次 API（約 20 tokens，成本可忽略），才知道金鑰是不是真的能用。
 * 舊版只回報「指令碼屬性有沒有填」，金鑰失效時仍會顯示「連線正常」，等按下分析才失敗。
 */
function ping_() {
  var key = getProp_('ANTHROPIC_API_KEY');
  // 只回長度與前後綴，用來分辨「貼漏了／貼到空白」跟「金鑰本身被拒」，不回傳金鑰內容
  var base = {
    ok: true, model: MODEL, keySet: !!key, secretRequired: !!getProp_('SHARED_SECRET'),
    keyShape: key ? {
      len: key.length,
      trimmedLen: key.trim().length,
      prefixOk: key.indexOf('sk-ant-') === 0,
      tail4: key.slice(-4)
    } : null
  };
  if (!key) {
    base.ok = false; base.keyWorks = false;
    base.error = 'NO_KEY';
    base.message = '後端尚未設定 ANTHROPIC_API_KEY（Apps Script → 專案設定 → 指令碼屬性）';
    return base;
  }

  var probe = function (withFallback) {
    var payload = { model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] };
    var headers = { 'x-api-key': key, 'anthropic-version': API_VERSION };
    if (withFallback) { payload.fallbacks = 'default'; headers['anthropic-beta'] = FALLBACK_BETA; }
    var r = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = r.getResponseCode(), text = r.getContentText(), m = text;
    try { m = JSON.parse(text).error.message; } catch (e) {}
    return { code: code, message: code === 200 ? '' : m };
  };

  var a = probe(true);
  base.withFallback = a;
  if (a.code === 200) { base.keyWorks = true; base.message = '金鑰正常，模型可用'; return base; }

  // 帶 beta 失敗時再試一次不帶，才能分辨是「金鑰壞了」還是「這個 beta 不能用」
  var b = probe(false);
  base.plain = b;
  base.keyWorks = (b.code === 200);
  base.ok = false;
  if (b.code === 200) {
    base.error = 'BETA_' + a.code;
    base.message = '金鑰正常，但 server-side fallback beta（' + FALLBACK_BETA + '）被拒：' + a.message;
  } else {
    base.error = 'API_' + b.code;
    base.message = apiHint_(b.code, b.message) + b.message;
  }
  return base;
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

/** 在編輯器直接執行：確認筆記頁的「論述」動作正常（1.1 的 Moral） */
function selfTestArgue() {
  var r = argueTopic_({
    section: '1.1',
    section_title: 'Moral and money',
    heading: 'Reasons to manage H&S',
    item: 'Moral 道德 — Workers expect to go home unharmed; society expects employers to care for people ' +
      'affected by their work.'
  });
  if (!r.ok) { console.error('失敗：' + r.error + ' — ' + r.message); return; }
  console.log('標題：' + r.data.title_en + ' / ' + r.data.title_zh);
  console.log('論述條數：' + r.data.argument.length + '　範例句：' + r.data.model_sentences.length +
              '　全部留空位：' + r.data.model_sentences.every(function (s) { return s.has_gap; }));
  console.log('命令詞：' + r.data.asked_as.map(function (a) { return a.command_word; }).join(', '));
  console.log('用量：in ' + r.usage.input + ' / out ' + r.usage.output + ' tokens ≈ US$' + r.usage.usd);
}
