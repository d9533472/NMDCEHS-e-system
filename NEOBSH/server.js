// server.js — AI grading backend for NEBOSH scenario practice
// Runs on port 8000 inside the sandbox. Deployed via deploy_website proxy (port/8000).
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const client = new Anthropic();
const MODEL = 'claude_sonnet_4_6';

// Load all element data files once at startup (used to fetch scenario + model answer as grading rubric)
const DATA_DIR = path.join(__dirname, '..', 'data');
const elements = {};
try {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    elements[raw.element_number] = raw;
  }
  console.log('Loaded element data for grading:', Object.keys(elements).sort((a, b) => a - b).join(', '));
} catch (err) {
  console.error('Failed to load element data directory:', err.message);
}

function findScenario(elementNumber, scenarioId) {
  const el = elements[elementNumber];
  if (!el) return null;
  return (el.scenario_questions || []).find((s) => s.id === scenarioId) || null;
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/grade-scenario', async (req, res) => {
  try {
    const { elementNumber, scenarioId, userAnswer } = req.body || {};
    if (!elementNumber || !scenarioId || typeof userAnswer !== 'string' || !userAnswer.trim()) {
      return res.status(400).json({ error: 'Missing elementNumber, scenarioId, or userAnswer.' });
    }
    const scenario = findScenario(Number(elementNumber), Number(scenarioId));
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found.' });
    }

    const rubricPoints = scenario.model_answer_points_en || [];
    const rubricList = rubricPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

    const systemPrompt = `You are an experienced NEBOSH International General Certificate examiner grading a candidate's written answer to a scenario-based practice question. Grade strictly but fairly against the provided marking-scheme bullet points (model answer points). Award partial credit for points that are substantively covered even if worded differently. Be encouraging but honest. Respond with STRICT JSON only, no markdown fences, matching this exact shape:
{
  "score": <integer, points awarded>,
  "max_score": <integer, equal to the number of marking points provided>,
  "covered_points_en": [<strings, model answer points the candidate's answer adequately covered>],
  "missed_points_en": [<strings, model answer points the candidate's answer missed or covered inadequately>],
  "feedback_en": "<2-4 sentences of constructive feedback in English>",
  "feedback_zh": "<Traditional Chinese translation of the feedback, 2-4 sentences>"
}`;

    const userPrompt = `SCENARIO:\n${scenario.scenario_en}\n\nTASK:\n${scenario.task_en}\n\nMARKING SCHEME (model answer points, ${rubricPoints.length} total):\n${rubricList}\n\nCANDIDATE'S ANSWER:\n${userAnswer.trim()}\n\nGrade the candidate's answer against the marking scheme above. Return ONLY the JSON object described in the system prompt.`;

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text response from model.');

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (e) {
      // Try to extract JSON if wrapped in extra text
      const match = textBlock.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse grading response.');
      parsed = JSON.parse(match[0]);
    }

    // Clamp score to sane bounds
    const maxScore = rubricPoints.length || parsed.max_score || 1;
    let score = Number(parsed.score);
    if (!Number.isFinite(score)) score = 0;
    score = Math.max(0, Math.min(maxScore, score));

    res.json({
      score,
      max_score: maxScore,
      covered_points_en: parsed.covered_points_en || [],
      missed_points_en: parsed.missed_points_en || [],
      feedback_en: parsed.feedback_en || '',
      feedback_zh: parsed.feedback_zh || '',
    });
  } catch (err) {
    console.error('Grading error:', err);
    res.status(422).json({ error: 'Grading failed. Please try again.' });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`NEBOSH grading server listening on ${PORT}`);
});
