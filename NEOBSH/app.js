(function () {
  'use strict';

  var DATA = window.NEBOSH_DATA || [];
  var IG1 = DATA.filter(function (e) { return e.unit === 'IG1'; }).sort(function(a,b){return a.element_number-b.element_number;});
  var IG2 = DATA.filter(function (e) { return e.unit === 'IG2'; }).sort(function(a,b){return a.element_number-b.element_number;});

  var state = {
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    lang: 'bilingual',
    scores: {},          // elementNum -> {score,total}
    quizState: {},       // elementNum -> { answers: {qId: idx}, submitted: bool, questions: [sampled 10 mcq] }
    scenarioState: {},   // elementNum -> { currentId, answerText, grading: bool, result: {...} }
    reviewState: {},     // elementNum -> { answers, submitted, questions, loading, empty }
    wrongCounts: {},     // elementNum(string) -> count of wrong questions saved on the server
    auth: { loggedIn: false, name: '' }
  };

  var API_BASE = 'port/8000'.indexOf('__') === 0 ? 'http://localhost:8000' : 'port/8000';

  var QUIZ_SAMPLE_SIZE = 10;

  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function sampleQuestions(mcqPool, n) {
    return shuffleArray(mcqPool).slice(0, Math.min(n, mcqPool.length));
  }

  function pickRandomScenario(list, excludeId) {
    var pool = list;
    if (excludeId != null && list.length > 1) {
      pool = list.filter(function (s) { return s.id !== excludeId; });
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* ---------------- Wrong-question bank (persisted server-side via SQLite) ---------------- */
  function fetchWrongCounts(onDone) {
    fetch(API_BASE + '/api/wrong-questions')
      .then(function (res) { return res.ok ? res.json() : { counts: {} }; })
      .then(function (data) {
        state.wrongCounts = data.counts || {};
        if (onDone) onDone();
      })
      .catch(function () { if (onDone) onDone(); });
  }

  function syncWrongQuestions(num, questions, answers) {
    var results = questions.map(function (q) {
      return { questionId: q.id, wrong: answers[q.id] !== q.correct_index };
    });
    fetch(API_BASE + '/api/wrong-questions/' + num + '/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: results })
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data) state.wrongCounts[num] = data.count;
      }).catch(function () {});
  }

  var root = document.getElementById('view-root');
  var html = document.documentElement;

  /* ---------------- Theme & Lang ---------------- */
  function applyTheme() {
    html.setAttribute('data-theme', state.theme);
    var btn = document.getElementById('theme-toggle');
    btn.innerHTML = state.theme === 'dark'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    btn.setAttribute('aria-label', state.theme === 'dark' ? '切換至淺色模式' : '切換至深色模式');
  }
  document.getElementById('theme-toggle').addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });
  document.getElementById('brand-home').addEventListener('click', function(){ location.hash = '#/'; });

  document.getElementById('lang-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-lang]');
    if (!btn) return;
    state.lang = btn.getAttribute('data-lang');
    Array.prototype.forEach.call(document.querySelectorAll('#lang-toggle button'), function (b) {
      b.classList.toggle('active', b === btn);
    });
    render();
  });

  function showEn() { return state.lang === 'bilingual' || state.lang === 'en'; }
  function showZh() { return state.lang === 'bilingual' || state.lang === 'zh'; }

  /* ---------------- Fake login gate ---------------- */
  var loginBtn = document.getElementById('login-btn');
  var loginModal = document.getElementById('login-modal');
  var loginNameInput = document.getElementById('login-name-input');

  function updateLoginUI() {
    if (state.auth.loggedIn) {
      loginBtn.className = 'login-btn is-logged-in';
      var nameLabel = esc(state.auth.name || GUEST_LABEL);
      loginBtn.innerHTML =
        '<span class="avatar-dot"></span>' +
        '<span class="login-label-full">' + nameLabel + ' · 登出</span>' +
        '<span class="login-label-short">登出</span>';
    } else {
      loginBtn.className = 'login-btn';
      loginBtn.innerHTML =
        '<span class="login-label-full">🔒 登入以使用全部功能</span>' +
        '<span class="login-label-short">🔒 登入</span>';
    }
  }
  var GUEST_LABEL = '訪客';

  function openLoginModal() {
    loginNameInput.value = state.auth.name || '';
    loginModal.classList.add('show');
    setTimeout(function () { loginNameInput.focus(); }, 50);
  }
  function closeLoginModal() { loginModal.classList.remove('show'); }

  function fetchAuthState(onDone) {
    fetch(API_BASE + '/api/auth')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data) { state.auth.loggedIn = !!data.loggedIn; state.auth.name = data.name || ''; }
        if (onDone) onDone();
      })
      .catch(function () { if (onDone) onDone(); });
  }

  loginBtn.addEventListener('click', function () {
    if (state.auth.loggedIn) {
      loginBtn.disabled = true;
      fetch(API_BASE + '/api/auth/logout', { method: 'POST' })
        .then(function () {})
        .catch(function () {})
        .then(function () {
          loginBtn.disabled = false;
          state.auth.loggedIn = false;
          state.auth.name = '';
          updateLoginUI();
          render();
        });
    } else {
      openLoginModal();
    }
  });
  document.getElementById('login-cancel').addEventListener('click', closeLoginModal);
  loginModal.addEventListener('click', function (e) { if (e.target === loginModal) closeLoginModal(); });
  document.getElementById('login-submit').addEventListener('click', function () {
    var submitBtn = document.getElementById('login-submit');
    var name = loginNameInput.value.trim();
    submitBtn.disabled = true;
    submitBtn.textContent = '登入中...';
    fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        state.auth.loggedIn = true;
        state.auth.name = (data && data.name) || name;
        updateLoginUI();
        closeLoginModal();
        render();
      })
      .catch(function () {
        // Backend unreachable — still unlock locally so the demo login never hard-blocks usage.
        state.auth.loggedIn = true;
        state.auth.name = name;
        updateLoginUI();
        closeLoginModal();
        render();
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = '登入解鎖';
      });
  });
  loginNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('login-submit').click();
  });

  // Call before running any action that should be gated behind the fake login.
  // Returns true if the action may proceed, false if it opened the login modal instead.
  function requireLogin() {
    if (state.auth.loggedIn) return true;
    openLoginModal();
    return false;
  }

  function lockedBannerHtml() {
    return state.auth.loggedIn ? '' :
      '<div class="locked-banner"><span>🔒 登入後才能作答、提交或送出讓 AI 評分,目前只能瀏覽題目內容。</span><button class="btn btn-primary btn-sm" id="locked-login-btn">立即登入</button></div>';
  }
  function bindLockedBanner() {
    var b = document.getElementById('locked-login-btn');
    if (b) b.addEventListener('click', openLoginModal);
  }

  updateLoginUI();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ICONS = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };

  /* ---------------- Router ---------------- */
  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', function () {
    applyTheme();
    render();
    fetchWrongCounts(function () { render(); });
    fetchAuthState(function () { updateLoginUI(); render(); });
  });

  function parseHash() {
    var h = location.hash.replace(/^#\//, '');
    var parts = h.split('/').filter(Boolean);
    return parts;
  }

  function findElement(num) {
    return DATA.find(function (e) { return e.element_number === Number(num); });
  }

  function render() {
    var parts = parseHash();
    window.scrollTo(0, 0);
    if (parts[0] === 'unit' && parts[1]) {
      renderUnitPage(parts[1]);
    } else if (parts[0] === 'element' && parts[1] && parts[2] === 'quiz') {
      renderQuizPage(findElement(parts[1]));
    } else if (parts[0] === 'element' && parts[1] && parts[2] === 'review') {
      renderReviewPage(findElement(parts[1]));
    } else if (parts[0] === 'element' && parts[1] && parts[2] === 'scenario') {
      renderScenarioPage(findElement(parts[1]));
    } else if (parts[0] === 'element' && parts[1]) {
      renderElementPage(findElement(parts[1]));
    } else {
      renderHome();
    }
  }

  /* ---------------- Home ---------------- */
  function renderHome() {
    var totalMcq = DATA.reduce(function (a, e) { return a + e.mcq.length; }, 0);
    var totalScenario = DATA.reduce(function (a, e) { return a + e.scenario_questions.length; }, 0);

    root.innerHTML =
      '<section class="hero">' +
        '<span class="hero-eyebrow">NEBOSH International General Certificate</span>' +
        '<h1>IG1 &amp; IG2 雙語模擬考練習中心</h1>' +
        '<p>依照 NEBOSH 官方課綱(Element 1–11)自製的雙語練習題,涵蓋 IG1 管理單元與 IG2 風險評估單元,每單元皆有選擇題自我測驗與情境式問答練習。</p>' +
        '<div class="stats-row">' +
          '<div class="stat-card"><div class="stat-num">11</div><div class="stat-label">Elements 單元</div></div>' +
          '<div class="stat-card"><div class="stat-num">' + totalMcq + '</div><div class="stat-label">選擇題</div></div>' +
          '<div class="stat-card"><div class="stat-num">' + totalScenario + '</div><div class="stat-label">情境練習</div></div>' +
        '</div>' +
      '</section>' +
      '<div class="unit-tabs">' +
        unitTabHtml('IG1', 'Management of Health and Safety', '開卷情境式考試 · Element 1–4', IG1.length) +
        unitTabHtml('IG2', 'Risk Assessment', '實地風險評估 · Element 5–11', IG2.length) +
      '</div>';

    Array.prototype.forEach.call(root.querySelectorAll('.unit-tab'), function (t) {
      t.addEventListener('click', function () { location.hash = '#/unit/' + t.dataset.unit; });
    });
  }

  function unitTabHtml(unit, enName, desc, count) {
    var color = unit === 'IG1' ? 'var(--color-ig1)' : 'var(--color-ig2)';
    var hl = unit === 'IG1' ? 'var(--color-ig1-highlight)' : 'var(--color-ig2-highlight)';
    return '<button class="unit-tab" data-unit="' + unit + '" style="--tab-color:' + color + ';--tab-highlight:' + hl + '">' +
      '<span class="tag">' + unit + ' · ' + count + ' Elements</span>' +
      '<span class="name">' + (unit === 'IG1' ? '管理健康與安全' : '風險評估') + '</span>' +
      '<span class="desc">' + esc(enName) + ' — ' + esc(desc) + '</span>' +
    '</button>';
  }

  /* ---------------- Unit list page ---------------- */
  function renderUnitPage(unit) {
    var list = unit === 'IG1' ? IG1 : IG2;
    var color = unit === 'IG1' ? 'var(--color-ig1)' : 'var(--color-ig2)';
    var hl = unit === 'IG1' ? 'var(--color-ig1-highlight)' : 'var(--color-ig2-highlight)';
    var subtitle = unit === 'IG1'
      ? 'Element 1–4 · 正式考試為開卷情境式問答(本頁選擇題僅供自我檢測知識點)'
      : 'Element 5–11 · 正式評估為實地工作場所風險評估報告(本頁選擇題僅供自我檢測知識點)';

    var cards = list.map(function (e) {
      var sc = state.scores[e.element_number];
      var badge = sc ? '<span class="badge score-badge">上次成績 ' + sc.score + '/' + sc.total + '</span>' : '';
      return (
        '<div class="element-card">' +
          '<span class="element-num" style="--card-color:' + color + ';--card-highlight:' + hl + '">' + e.element_number + '</span>' +
          '<h3>' + esc(e.title_zh) + '</h3>' +
          (showEn() ? '<div class="en">' + esc(e.title_en) + '</div>' : '') +
          '<div class="element-badges">' +
            '<span class="badge">' + e.mcq.length + ' 題庫 · 每次抽 ' + QUIZ_SAMPLE_SIZE + ' 題</span>' +
            '<span class="badge">' + e.scenario_questions.length + ' 題庫 · 每次抽 1 題</span>' +
            badge +
          '</div>' +
          '<div class="element-actions">' +
            '<button class="btn btn-primary btn-block" data-go="#/element/' + e.element_number + '/quiz">選擇題測驗</button>' +
            '<button class="btn btn-outline btn-block" data-go="#/element/' + e.element_number + '/scenario">情境練習</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    root.innerHTML =
      '<div class="page-header" style="--pg-color:' + color + '">' +
        backLink('#/', '返回首頁') +
        '<span class="tag">Unit ' + unit + '</span>' +
        '<h1>' + (unit === 'IG1' ? '管理健康與安全' : '風險評估') + '</h1>' +
        '<div class="en-title">' + subtitle + '</div>' +
      '</div>' +
      '<div class="element-grid">' + cards + '</div>';

    bindGoButtons();
  }

  function backLink(href, label) {
    return '<a class="back-link" data-go="' + href + '" href="' + href + '">' + ICONS.back + ' ' + label + '</a>';
  }

  function bindGoButtons() {
    Array.prototype.forEach.call(root.querySelectorAll('[data-go]'), function (el) {
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        location.hash = el.getAttribute('data-go');
      });
    });
  }

  /* ---------------- Element detail (mode select) ---------------- */
  function renderElementPage(e) {
    if (!e) { renderHome(); return; }
    var color = e.unit === 'IG1' ? 'var(--color-ig1)' : 'var(--color-ig2)';
    var wrongCount = state.wrongCounts[e.element_number] || 0;
    var reviewCard = wrongCount > 0
      ? '<button class="mode-card mode-card-review" data-go="#/element/' + e.element_number + '/review"><h4>🔁 錯題複習(' + wrongCount + ' 題待複習)</h4><p>只重複練習你之前答錯的題目,答對後會自動從錯題本移除</p></button>'
      : '<button class="mode-card mode-card-review disabled" disabled><h4>🔁 錯題複習</h4><p>目前沒有錯題紀錄,先完成一次選擇題測驗吧!</p></button>';
    root.innerHTML =
      '<div class="page-header" style="--pg-color:' + color + '">' +
        backLink('#/unit/' + e.unit, '返回 ' + e.unit + ' 單元列表') +
        '<span class="tag">' + e.unit + ' · Element ' + e.element_number + '</span>' +
        '<h1>' + esc(e.title_zh) + '</h1>' +
        '<div class="en-title">' + esc(e.title_en) + '</div>' +
        '<div class="mode-switch">' +
          '<button class="mode-card" data-go="#/element/' + e.element_number + '/quiz"><h4>選擇題測驗(題庫 ' + e.mcq.length + ' 題,隨機抽 ' + QUIZ_SAMPLE_SIZE + ' 題)</h4><p>快速自我測驗本單元知識點,附詳解</p></button>' +
          '<button class="mode-card" data-go="#/element/' + e.element_number + '/scenario"><h4>情境練習(題庫 ' + e.scenario_questions.length + ' 題,隨機抽 1 題)</h4><p>模擬情境問答,可自行對照參考答案,也可送出讓 AI 評分給回饋</p></button>' +
          reviewCard +
        '</div>' +
      '</div>';
    bindGoButtons();
  }

  /* ---------------- Quiz Page ---------------- */
  function renderQuizPage(e) {
    if (!e) { renderHome(); return; }
    var num = e.element_number;
    var color = e.unit === 'IG1' ? 'var(--color-ig1)' : 'var(--color-ig2)';
    if (!state.quizState[num]) {
      state.quizState[num] = { answers: {}, submitted: false, questions: sampleQuestions(e.mcq, QUIZ_SAMPLE_SIZE) };
    }
    var qs = state.quizState[num];
    var questions = qs.questions;

    var questionsHtml = questions.map(function (q, idx) {
      var selected = qs.answers[q.id];
      var optionsHtml = q.options.map(function (opt, oi) {
        var cls = 'option-item';
        var icon = '';
        if (qs.submitted) {
          if (oi === q.correct_index) { cls += ' correct'; icon = ICONS.check; }
          else if (oi === selected) { cls += ' incorrect'; icon = ICONS.cross; }
        } else if (selected === oi) {
          cls += ' selected';
        }
        if (!qs.submitted && !state.auth.loggedIn) cls += ' locked';
        return (
          '<div class="' + cls + '" data-el="' + num + '" data-q="' + q.id + '" data-opt="' + oi + '">' +
            '<span class="option-radio">' + icon + '</span>' +
            '<span class="option-text">' +
              (showEn() ? '<div class="en">' + esc(opt.en) + '</div>' : '') +
              (showZh() ? '<div class="zh">' + esc(opt.zh) + '</div>' : '') +
            '</span>' +
          '</div>'
        );
      }).join('');

      var explanation = qs.submitted ? (
        '<div class="explanation-box show">' +
          '<div class="label">詳解 Explanation</div>' +
          (showEn() ? '<div class="en">' + esc(q.explanation_en) + '</div>' : '') +
          (showZh() ? '<div class="zh">' + esc(q.explanation_zh) + '</div>' : '') +
        '</div>'
      ) : '';

      return (
        '<div class="question-card">' +
          '<div class="question-num">Question ' + (idx + 1) + ' / ' + questions.length + '</div>' +
          (showEn() ? '<div class="question-text">' + esc(q.question_en) + '</div>' : '') +
          (showZh() ? '<div class="question-text-zh">' + esc(q.question_zh) + '</div>' : '') +
          '<div class="option-list">' + optionsHtml + '</div>' +
          explanation +
        '</div>'
      );
    }).join('');

    var answeredCount = Object.keys(qs.answers).length;
    var total = questions.length;

    var summaryHtml = '';
    if (qs.submitted) {
      var score = questions.reduce(function (acc, q) { return acc + (qs.answers[q.id] === q.correct_index ? 1 : 0); }, 0);
      state.scores[num] = { score: score, total: total };
      var pct = Math.round((score / total) * 100);
      summaryHtml =
        '<div class="quiz-summary show">' +
          '<div class="score">' + score + ' / ' + total + '</div>' +
          '<div class="score-label">答對率 ' + pct + '% — ' + (pct >= 75 ? '表現優異,持續保持!' : pct >= 45 ? '及格水準,再加強細節就更好了' : '建議重新複習本單元課綱內容') + '</div>' +
          '<div class="quiz-summary-actions">' +
            '<button class="btn btn-outline" data-retake="' + num + '">換一組題目重新測驗</button>' +
            '<button class="btn btn-primary" data-go="#/element/' + num + '">返回單元頁面</button>' +
          '</div>' +
        '</div>';
    }

    root.innerHTML =
      '<div class="page-header" style="--pg-color:' + color + '">' +
        backLink('#/element/' + num, '返回單元頁面') +
        '<span class="tag">' + e.unit + ' · Element ' + num + ' · 選擇題測驗(本次從 ' + e.mcq.length + ' 題庫隨機抽取 ' + total + ' 題)</span>' +
        '<h1>' + esc(e.title_zh) + '</h1>' +
        (showEn() ? '<div class="en-title">' + esc(e.title_en) + '</div>' : '') +
      '</div>' +
      lockedBannerHtml() +
      summaryHtml +
      questionsHtml +
      (qs.submitted ? '' :
        '<div class="sticky-bar">' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + (total ? (answeredCount / total * 100) : 0) + '%"></div></div>' +
          '<span class="progress-text">已作答 ' + answeredCount + ' / ' + total + '</span>' +
          '<button class="btn btn-primary" id="submit-quiz" ' + (answeredCount < total ? 'disabled style="opacity:.5;cursor:not-allowed;"' : '') + '>提交測驗</button>' +
        '</div>'
      );

    bindGoButtons();
    bindLockedBanner();

    if (!qs.submitted) {
      Array.prototype.forEach.call(root.querySelectorAll('.option-item'), function (opt) {
        opt.addEventListener('click', function () {
          if (!requireLogin()) return;
          var qid = Number(opt.dataset.q);
          var oi = Number(opt.dataset.opt);
          qs.answers[qid] = oi;
          renderQuizPage(e);
        });
      });
      var submitBtn = document.getElementById('submit-quiz');
      if (submitBtn) {
        submitBtn.addEventListener('click', function () {
          if (!requireLogin()) return;
          if (Object.keys(qs.answers).length < total) return;
          qs.submitted = true;
          syncWrongQuestions(num, questions, qs.answers);
          renderQuizPage(e);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
    } else {
      var retakeBtn = root.querySelector('[data-retake]');
      if (retakeBtn) {
        retakeBtn.addEventListener('click', function () {
          if (!requireLogin()) return;
          state.quizState[num] = { answers: {}, submitted: false, questions: sampleQuestions(e.mcq, QUIZ_SAMPLE_SIZE) };
          renderQuizPage(e);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
    }
  }

  /* ---------------- Wrong-question Review Page ---------------- */
  function loadReviewQuestions(e, cb) {
    var num = e.element_number;
    fetch(API_BASE + '/api/wrong-questions/' + num)
      .then(function (res) { return res.ok ? res.json() : { questionIds: [] }; })
      .then(function (data) {
        var ids = data.questionIds || [];
        state.wrongCounts[num] = ids.length;
        if (!ids.length) {
          state.reviewState[num] = { status: 'empty' };
        } else {
          var pool = e.mcq.filter(function (q) { return ids.indexOf(q.id) !== -1; });
          state.reviewState[num] = {
            status: 'ready',
            answers: {},
            submitted: false,
            questions: sampleQuestions(pool, QUIZ_SAMPLE_SIZE)
          };
        }
        if (cb) cb();
      })
      .catch(function () {
        state.reviewState[num] = { status: 'empty' };
        if (cb) cb();
      });
  }

  function renderReviewPage(e) {
    if (!e) { renderHome(); return; }
    var num = e.element_number;
    var color = e.unit === 'IG1' ? 'var(--color-ig1)' : 'var(--color-ig2)';

    if (!state.reviewState[num]) {
      state.reviewState[num] = { status: 'loading' };
      loadReviewQuestions(e, function () { renderReviewPage(e); });
    }
    var rs = state.reviewState[num];

    if (rs.status === 'loading') {
      root.innerHTML =
        '<div class="page-header" style="--pg-color:' + color + '">' +
          backLink('#/element/' + num, '返回單元頁面') +
          '<span class="tag">' + e.unit + ' · Element ' + num + ' · 錯題複習</span>' +
          '<h1>' + esc(e.title_zh) + '</h1>' +
        '</div>' +
        '<div class="empty-state">載入錯題中... Loading your wrong-question set...</div>';
      bindGoButtons();
      return;
    }

    if (rs.status === 'empty') {
      root.innerHTML =
        '<div class="page-header" style="--pg-color:' + color + '">' +
          backLink('#/element/' + num, '返回單元頁面') +
          '<span class="tag">' + e.unit + ' · Element ' + num + ' · 錯題複習</span>' +
          '<h1>' + esc(e.title_zh) + '</h1>' +
        '</div>' +
        '<div class="empty-state">🎉 太棒了,這個單元目前沒有待複習的錯題!先去做一次選擇題測驗,答錯的題目會自動收進這裡。<br/>Great job — no wrong questions saved for this element yet. Take a quiz first and any mistakes will be collected here automatically.' +
          '<div style="margin-top:16px;"><button class="btn btn-primary" data-go="#/element/' + num + '/quiz">前往選擇題測驗</button></div>' +
        '</div>';
      bindGoButtons();
      return;
    }

    var questions = rs.questions;
    var questionsHtml = questions.map(function (q, idx) {
      var selected = rs.answers[q.id];
      var optionsHtml = q.options.map(function (opt, oi) {
        var cls = 'option-item';
        var icon = '';
        if (rs.submitted) {
          if (oi === q.correct_index) { cls += ' correct'; icon = ICONS.check; }
          else if (oi === selected) { cls += ' incorrect'; icon = ICONS.cross; }
        } else if (selected === oi) {
          cls += ' selected';
        }
        if (!rs.submitted && !state.auth.loggedIn) cls += ' locked';
        return (
          '<div class="' + cls + '" data-el="' + num + '" data-q="' + q.id + '" data-opt="' + oi + '">' +
            '<span class="option-radio">' + icon + '</span>' +
            '<span class="option-text">' +
              (showEn() ? '<div class="en">' + esc(opt.en) + '</div>' : '') +
              (showZh() ? '<div class="zh">' + esc(opt.zh) + '</div>' : '') +
            '</span>' +
          '</div>'
        );
      }).join('');

      var explanation = rs.submitted ? (
        '<div class="explanation-box show">' +
          '<div class="label">詳解 Explanation</div>' +
          (showEn() ? '<div class="en">' + esc(q.explanation_en) + '</div>' : '') +
          (showZh() ? '<div class="zh">' + esc(q.explanation_zh) + '</div>' : '') +
        '</div>'
      ) : '';

      return (
        '<div class="question-card">' +
          '<div class="question-num">Question ' + (idx + 1) + ' / ' + questions.length + '</div>' +
          (showEn() ? '<div class="question-text">' + esc(q.question_en) + '</div>' : '') +
          (showZh() ? '<div class="question-text-zh">' + esc(q.question_zh) + '</div>' : '') +
          '<div class="option-list">' + optionsHtml + '</div>' +
          explanation +
        '</div>'
      );
    }).join('');

    var answeredCount = Object.keys(rs.answers).length;
    var total = questions.length;

    var summaryHtml = '';
    if (rs.submitted) {
      var score = questions.reduce(function (acc, q) { return acc + (rs.answers[q.id] === q.correct_index ? 1 : 0); }, 0);
      var pct = Math.round((score / total) * 100);
      summaryHtml =
        '<div class="quiz-summary show">' +
          '<div class="score">' + score + ' / ' + total + '</div>' +
          '<div class="score-label">答對率 ' + pct + '% — 答對的題目已從錯題本移除,答錯的會繼續留著下次複習</div>' +
          '<div class="quiz-summary-actions">' +
            '<button class="btn btn-outline" data-retake-review="' + num + '">再複習一輪</button>' +
            '<button class="btn btn-primary" data-go="#/element/' + num + '">返回單元頁面</button>' +
          '</div>' +
        '</div>';
    }

    root.innerHTML =
      '<div class="page-header" style="--pg-color:' + color + '">' +
        backLink('#/element/' + num, '返回單元頁面') +
        '<span class="tag">' + e.unit + ' · Element ' + num + ' · 錯題複習(從 ' + total + ' 題錯題中抽取)</span>' +
        '<h1>' + esc(e.title_zh) + '</h1>' +
        (showEn() ? '<div class="en-title">' + esc(e.title_en) + '</div>' : '') +
      '</div>' +
      lockedBannerHtml() +
      summaryHtml +
      questionsHtml +
      (rs.submitted ? '' :
        '<div class="sticky-bar">' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + (total ? (answeredCount / total * 100) : 0) + '%"></div></div>' +
          '<span class="progress-text">已作答 ' + answeredCount + ' / ' + total + '</span>' +
          '<button class="btn btn-primary" id="submit-review" ' + (answeredCount < total ? 'disabled style="opacity:.5;cursor:not-allowed;"' : '') + '>提交複習</button>' +
        '</div>'
      );

    bindGoButtons();
    bindLockedBanner();

    if (!rs.submitted) {
      Array.prototype.forEach.call(root.querySelectorAll('.option-item'), function (opt) {
        opt.addEventListener('click', function () {
          if (!requireLogin()) return;
          var qid = Number(opt.dataset.q);
          var oi = Number(opt.dataset.opt);
          rs.answers[qid] = oi;
          renderReviewPage(e);
        });
      });
      var submitBtn = document.getElementById('submit-review');
      if (submitBtn) {
        submitBtn.addEventListener('click', function () {
          if (!requireLogin()) return;
          if (Object.keys(rs.answers).length < total) return;
          rs.submitted = true;
          syncWrongQuestions(num, questions, rs.answers);
          renderReviewPage(e);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
    } else {
      var retakeBtn = root.querySelector('[data-retake-review]');
      if (retakeBtn) {
        retakeBtn.addEventListener('click', function () {
          if (!requireLogin()) return;
          state.reviewState[num] = { status: 'loading' };
          renderReviewPage(e);
          loadReviewQuestions(e, function () { renderReviewPage(e); });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
    }
  }

  /* ---------------- Scenario Page ---------------- */
  function renderScenarioPage(e) {
    if (!e) { renderHome(); return; }
    var num = e.element_number;
    var color = e.unit === 'IG1' ? 'var(--color-ig1)' : 'var(--color-ig2)';
    var list = e.scenario_questions;

    if (!state.scenarioState[num]) {
      var picked = pickRandomScenario(list);
      state.scenarioState[num] = { currentId: picked.id, answerText: '', grading: false, result: null, error: null, revealed: false };
    }
    var ss = state.scenarioState[num];
    var s = list.find(function (x) { return x.id === ss.currentId; }) || list[0];

    var modelPointsEn = s.model_answer_points_en.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    var modelPointsZh = s.model_answer_points_zh.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');

    var resultHtml = '';
    if (ss.result) {
      var r = ss.result;
      var pct2 = r.max_score ? Math.round((r.score / r.max_score) * 100) : 0;
      var coveredHtml = (r.covered_points_en || []).map(function (p) { return '<li class="covered">' + ICONS.check + '<span>' + esc(p) + '</span></li>'; }).join('');
      var missedHtml = (r.missed_points_en || []).map(function (p) { return '<li class="missed">' + ICONS.cross + '<span>' + esc(p) + '</span></li>'; }).join('');
      resultHtml =
        '<div class="ai-result show">' +
          '<div class="ai-result-header">' +
            '<span class="ai-badge">AI 評分結果 · AI Grading</span>' +
            '<span class="ai-score">' + r.score + ' / ' + r.max_score + '</span>' +
          '</div>' +
          '<div class="ai-feedback">' +
            (showEn() ? '<div class="en">' + esc(r.feedback_en) + '</div>' : '') +
            (showZh() ? '<div class="zh">' + esc(r.feedback_zh) + '</div>' : '') +
          '</div>' +
          (coveredHtml ? '<div class="ai-points-label">已涵蓋要點 Covered</div><ul class="ai-points">' + coveredHtml + '</ul>' : '') +
          (missedHtml ? '<div class="ai-points-label">遺漏要點 Missed</div><ul class="ai-points">' + missedHtml + '</ul>' : '') +
        '</div>';
    } else if (ss.error) {
      resultHtml = '<div class="ai-result show ai-error">' + esc(ss.error) + '</div>';
    }

    root.innerHTML =
      '<div class="page-header" style="--pg-color:' + color + '">' +
        backLink('#/element/' + num, '返回單元頁面') +
        '<span class="tag">' + e.unit + ' · Element ' + num + ' · 情境練習(本次從 ' + list.length + ' 題庫隨機抽取)</span>' +
        '<h1>' + esc(e.title_zh) + '</h1>' +
        (showEn() ? '<div class="en-title">' + esc(e.title_en) + '</div>' : '') +
      '</div>' +
      lockedBannerHtml() +
      '<div class="scenario-toolbar">' +
        '<button class="btn btn-outline" id="shuffle-scenario">🔀 換一題</button>' +
      '</div>' +
      '<div class="scenario-card">' +
        '<div class="scenario-label">Scenario 情境案例</div>' +
        (showEn() ? '<div class="scenario-text">' + esc(s.scenario_en) + '</div>' : '') +
        (showZh() ? '<div class="scenario-text scenario-text-zh">' + esc(s.scenario_zh) + '</div>' : '') +
        '<div class="task-box">' +
          (showEn() ? '<div class="en">' + esc(s.task_en) + '</div>' : '') +
          (showZh() ? '<div class="zh">' + esc(s.task_zh) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<textarea class="answer-textarea' + (state.auth.loggedIn ? '' : ' locked') + '" id="answer-textarea" ' + (state.auth.loggedIn ? '' : 'readonly') + ' placeholder="在這裡寫下你的作答,可以送出讓 AI 評分,也可以直接對照參考答案要點......">' + esc(ss.answerText) + '</textarea>' +
      '<div class="scenario-actions">' +
        '<button class="btn btn-primary" id="grade-answer"' + (ss.grading ? ' disabled' : '') + '>' + (ss.grading ? '評分中...' : '送出讓 AI 評分') + '</button>' +
        '<button class="btn btn-outline" id="reveal-answer">' + (ss.revealed ? '隱藏參考答案要點' : '顯示參考答案要點') + '</button>' +
      '</div>' +
      resultHtml +
      '<div class="model-answer' + (ss.revealed ? ' show' : '') + '" id="model-answer">' +
        (showEn() ? '<div class="label">Model Answer Points</div><ul>' + modelPointsEn + '</ul>' : '') +
        (showZh() ? '<div class="label zh-points-label">參考答案要點</div><ul class="zh-points">' + modelPointsZh + '</ul>' : '') +
      '</div>';

    bindGoButtons();
    bindLockedBanner();

    document.getElementById('shuffle-scenario').addEventListener('click', function () {
      if (!requireLogin()) return;
      var next = pickRandomScenario(list, ss.currentId);
      state.scenarioState[num] = { currentId: next.id, answerText: '', grading: false, result: null, error: null, revealed: false };
      renderScenarioPage(e);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    var textarea = document.getElementById('answer-textarea');
    textarea.addEventListener('input', function () { ss.answerText = textarea.value; });
    textarea.addEventListener('click', function () { if (!state.auth.loggedIn) requireLogin(); });

    var revealBtn = document.getElementById('reveal-answer');
    var modelBox = document.getElementById('model-answer');
    revealBtn.addEventListener('click', function () {
      if (!requireLogin()) return;
      ss.revealed = !ss.revealed;
      modelBox.classList.toggle('show', ss.revealed);
      revealBtn.textContent = ss.revealed ? '隱藏參考答案要點' : '顯示參考答案要點';
    });

    var gradeBtn = document.getElementById('grade-answer');
    gradeBtn.addEventListener('click', function () {
      if (!requireLogin()) return;
      if (ss.grading) return;
      var answerText = textarea.value.trim();
      if (!answerText) {
        ss.error = '請先輸入你的作答內容再送出評分。 Please write an answer before submitting for grading.';
        renderScenarioPage(e);
        return;
      }
      ss.grading = true;
      ss.error = null;
      ss.result = null;
      renderScenarioPage(e);
      fetch(API_BASE + '/api/grade-scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elementNumber: num, scenarioId: s.id, userAnswer: answerText })
      }).then(function (res) {
        if (!res.ok) throw new Error('評分服務暫時無法使用,請稍後再試。');
        return res.json();
      }).then(function (data) {
        ss.grading = false;
        ss.result = data;
        renderScenarioPage(e);
        var resultEl = document.querySelector('.ai-result');
        if (resultEl) resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }).catch(function (err) {
        ss.grading = false;
        ss.error = err.message || '評分失敗,請稍後再試。';
        renderScenarioPage(e);
      });
    });
  }

})();
