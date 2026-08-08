/**
 * 乙級職業安全衛生管理員 題庫練習系統
 * Main Application - Single Page App
 */

const App = {
  units: [],
  parts: [],
  questionCache: {},
  currentExam: null,
  timer: null,
  route: { page: 'home', params: {} },

  async init() {
    try {
      const res = await fetch('data/units.json');
      const data = await res.json();
      this.parts = data.parts;
      this.units = data.units;
      this.examTitle = data.examTitle;
      this.examSubtitle = data.examSubtitle;
      this.disclaimer = data.disclaimer;
    } catch(e) {
      console.error('Failed to load units.json:', e);
    }
    this.parseHash();
    window.addEventListener('hashchange', () => this.parseHash());
    this.render();
  },

  parseHash() {
    const hash = window.location.hash.slice(1) || 'home';
    const parts = hash.split('/');
    this.route = { page: parts[0] || 'home', params: parts.slice(1) };
    this.render();
    window.scrollTo(0, 0);
  },

  navigate(page, ...params) {
    window.location.hash = [page, ...params].join('/');
  },

  render() {
    const app = document.getElementById('app');
    switch(this.route.page) {
      case 'unit': this.renderUnitExam(app, this.route.params[0]); break;
      case 'mock': this.renderMockExam(app, this.route.params[0]); break;
      case 'random': this.renderRandomExam(app); break;
      case 'results': this.renderResults(app); break;
      case 'wrongbook': this.renderWrongBook(app); break;
      default: this.renderHome(app);
    }
  },

  // ===== Load Questions =====
  async loadQuestions(unitId) {
    if (this.questionCache[unitId]) return this.questionCache[unitId];
    try {
      const res = await fetch(`data/questions/${unitId}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      this.questionCache[unitId] = data;
      return data;
    } catch(e) {
      return null;
    }
  },

  async loadAllQuestions() {
    const all = [];
    for (const unit of this.units) {
      const q = await this.loadQuestions(unit.id);
      if (q && q.questions) {
        q.questions.forEach(item => all.push({ ...item, unitId: unit.id, unitTitle: unit.title }));
      }
    }
    return all;
  },

  // ===== Homepage =====
  renderHome(app) {
    const progress = this.getProgress();
    const totalAnswered = Object.values(progress).reduce((s, v) => s + (v.answered || 0), 0);
    const totalCorrect = Object.values(progress).reduce((s, v) => s + (v.correct || 0), 0);
    const unitsWithData = Object.keys(this.questionCache).filter(k => this.questionCache[k]).length;

    let html = `
      <header class="app-header">
        <h1>${this.examTitle || '乙級職業安全衛生管理員 題庫練習系統'}</h1>
        <div class="subtitle">${this.examSubtitle || ''}</div>
      </header>
      <div class="container">
        <div class="hero-section">
          <h2>40 單元完整題庫系統</h2>
          <p>單選、複選、是非、填充、計算、配合、排序 — 全題型覆蓋</p>
        </div>
        <div class="disclaimer-box">${this.disclaimer || ''}</div>
        <div class="stats-bar">
          <div class="stat-card"><div class="num">40</div><div class="label">單元數</div></div>
          <div class="stat-card"><div class="num" id="totalQ">--</div><div class="label">總題數</div></div>
          <div class="stat-card"><div class="num">${totalAnswered}</div><div class="label">已作答</div></div>
          <div class="stat-card"><div class="num">${totalCorrect}</div><div class="label">答對數</div></div>
        </div>
        <div class="mode-cards">
          <div class="mode-card" onclick="App.navigate('mock','subject')">
            <div class="icon">📝</div>
            <h3>學科模擬考</h3>
            <p>單選60題+複選20題<br>100分鐘</p>
          </div>
          <div class="mode-card" onclick="App.navigate('mock','skill')">
            <div class="icon">🔧</div>
            <h3>術科模擬考</h3>
            <p>10題組<br>100分鐘</p>
          </div>
          <div class="mode-card" onclick="App.navigate('random')">
            <div class="icon">🎲</div>
            <h3>隨機練習</h3>
            <p>全範圍隨機抽題<br>自選題數</p>
          </div>
          <div class="mode-card" onclick="App.navigate('wrongbook')">
            <div class="icon">📕</div>
            <h3>錯題本</h3>
            <p>複習答錯的題目<br>加強弱點</p>
          </div>
        </div>
    `;

    // Render parts and units
    for (const part of this.parts) {
      const partUnits = this.units.filter(u => u.part === part.id);
      html += `<div class="part-section">`;
      html += `<div class="part-title">${part.name}<span class="part-count">${partUnits.length} 單元</span></div>`;
      html += `<div class="unit-grid">`;
      for (const unit of partUnits) {
        const p = progress[unit.id] || {};
        const answered = p.answered || 0;
        const total = p.total || 0;
        let badgeClass = 'not-started';
        let badgeText = '未開始';
        if (total > 0 && answered >= total) { badgeClass = 'complete'; badgeText = '已完成'; }
        else if (answered > 0) { badgeClass = 'in-progress'; badgeText = `${answered}/${total}`; }

        html += `
          <div class="unit-card" onclick="App.navigate('unit','${unit.id}')">
            <div class="unit-num">第 ${unit.number} 單元</div>
            <div class="unit-title">${unit.title}</div>
            <div class="unit-meta">
              <span class="progress-badge ${badgeClass}">${badgeText}</span>
              <span class="loading-status" id="status-${unit.id}">載入中...</span>
            </div>
          </div>
        `;
      }
      html += `</div></div>`;
    }

    html += `
      <div class="app-footer">
        <p>本系統為依官方技能規範與現行法規自編練習題，非官方題庫。</p>
        <p>法規來源：<a href="https://law.moj.gov.tw/" target="_blank">全國法規資料庫</a> · <a href="https://www.osha.gov.tw/" target="_blank">職業安全衛生署</a></p>
      </div>
    </div>`;

    app.innerHTML = html;

    // Async check which units have question banks
    this.checkUnitAvailability();
  },

  async checkUnitAvailability() {
    let totalQ = 0;
    for (const unit of this.units) {
      const el = document.getElementById(`status-${unit.id}`);
      if (!el) continue;
      const data = await this.loadQuestions(unit.id);
      if (data && data.questions && data.questions.length > 0) {
        el.textContent = `${data.questions.length} 題`;
        el.style.color = 'var(--success)';
        totalQ += data.questions.length;
        const progress = this.getProgress();
        if (!progress[unit.id]) {
          progress[unit.id] = { total: data.questions.length, answered: 0, correct: 0 };
          this.saveProgress(progress);
        } else if (!progress[unit.id].total) {
          progress[unit.id].total = data.questions.length;
          this.saveProgress(progress);
        }
      } else {
        el.textContent = '敬請期待';
        el.style.color = 'var(--text-light)';
      }
    }
    const totalEl = document.getElementById('totalQ');
    if (totalEl) totalEl.textContent = totalQ;
  },

  // ===== Unit Exam =====
  async renderUnitExam(app, unitId) {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) { this.navigate('home'); return; }

    app.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>載入題庫中...</p></div>`;

    const data = await this.loadQuestions(unitId);
    if (!data || !data.questions || data.questions.length === 0) {
      app.innerHTML = `
        <header class="app-header">
          <button class="nav-back" onclick="App.navigate('home')">← 返回首頁</button>
          <h1>第 ${unit.number} 單元</h1>
          <div class="subtitle">${unit.title}</div>
        </header>
        <div class="container">
          <div class="no-data-warning">
            <h3>題庫建置中</h3>
            <p>本單元題庫尚未完成，請稍後再來練習。</p>
          </div>
          <div style="text-align:center;margin:1rem 0">
            <button class="btn btn-primary" onclick="App.navigate('home')">返回首頁</button>
          </div>
        </div>
      `;
      return;
    }

    this.currentExam = {
      type: 'unit',
      unitId: unitId,
      unitTitle: unit.title,
      unitNumber: unit.number,
      questions: this.shuffle(data.questions.slice()),
      answers: {},
      startTime: Date.now(),
      showExplanations: false
    };

    this.renderExamPage(app);
  },

  // ===== Mock Exam =====
  async renderMockExam(app, examType) {
    app.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>載入題庫中...</p></div>`;
    
    const allQuestions = await this.loadAllQuestions();
    if (allQuestions.length === 0) {
      app.innerHTML = `
        <header class="app-header">
          <button class="nav-back" onclick="App.navigate('home')">← 返回首頁</button>
          <h1>模擬考</h1>
        </header>
        <div class="container">
          <div class="no-data-warning">
            <h3>尚無題庫資料</h3>
            <p>目前沒有可用的題庫，請先完成單元題庫建置。</p>
          </div>
          <div style="text-align:center;margin:1rem 0">
            <button class="btn btn-primary" onclick="App.navigate('home')">返回首頁</button>
          </div>
        </div>
      `;
      return;
    }

    let examQuestions = [];
    let examTitle = '';
    let duration = 100 * 60 * 1000; // 100 minutes

    if (examType === 'subject') {
      examTitle = '學科模擬考';
      const singles = this.shuffle(allQuestions.filter(q => q.type === 'single_choice')).slice(0, Math.min(60, allQuestions.filter(q => q.type === 'single_choice').length));
      const multiples = this.shuffle(allQuestions.filter(q => q.type === 'multiple_choice')).slice(0, Math.min(20, allQuestions.filter(q => q.type === 'multiple_choice').length));
      examQuestions = [...singles, ...multiples];
    } else if (examType === 'skill') {
      examTitle = '術科模擬考';
      // Use various question types for skill exam
      const types = ['fill_blank', 'calculation', 'matching', 'ordering', 'true_false', 'single_choice', 'multiple_choice'];
      const pools = {};
      types.forEach(t => { pools[t] = this.shuffle(allQuestions.filter(q => q.type === t)); });
      
      // Build 10 question groups (each group ~5 questions)
      let pool = this.shuffle(allQuestions);
      examQuestions = pool.slice(0, Math.min(50, pool.length));
    }

    this.currentExam = {
      type: 'mock',
      examType: examType,
      examTitle: examTitle,
      questions: examQuestions,
      answers: {},
      startTime: Date.now(),
      duration: duration,
      showExplanations: false,
      isTimed: true
    };

    this.renderExamPage(app);
  },

  // ===== Random Exam =====
  async renderRandomExam(app) {
    app.innerHTML = `
      <header class="app-header">
        <button class="nav-back" onclick="App.navigate('home')">← 返回首頁</button>
        <h1>隨機練習</h1>
      </header>
      <div class="container">
        <div class="loading-spinner"><div class="spinner"></div><p>載入題庫中...</p></div>
      </div>
    `;
    
    const allQuestions = await this.loadAllQuestions();
    if (allQuestions.length === 0) {
      app.querySelector('.container').innerHTML = `
        <div class="no-data-warning">
          <h3>尚無題庫資料</h3>
          <p>目前沒有可用的題庫，請先完成單元題庫建置。</p>
        </div>
        <div style="text-align:center;margin:1rem 0">
          <button class="btn btn-primary" onclick="App.navigate('home')">返回首頁</button>
        </div>
      `;
      return;
    }

    // Show configuration
    app.querySelector('.container').innerHTML = `
      <div class="hero-section">
        <h2>隨機練習</h2>
        <p>從所有題庫中隨機抽取題目練習</p>
      </div>
      <div style="max-width:500px;margin:0 auto">
        <label style="display:block;margin-bottom:0.5rem;font-weight:700;color:var(--primary)">選擇題數</label>
        <select id="randomCount" class="search-box" style="margin-bottom:1rem">
          <option value="10">10 題</option>
          <option value="20" selected>20 題</option>
          <option value="30">30 題</option>
          <option value="50">50 題</option>
          <option value="80">80 題（全真模擬）</option>
        </select>
        <label style="display:block;margin-bottom:0.5rem;font-weight:700;color:var(--primary)">題型篩選（可多選）</label>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.5rem">
          <label class="filter-tab active" style="cursor:pointer"><input type="checkbox" value="single_choice" checked> 單選題</label>
          <label class="filter-tab active" style="cursor:pointer"><input type="checkbox" value="multiple_choice" checked> 複選題</label>
          <label class="filter-tab active" style="cursor:pointer"><input type="checkbox" value="true_false" checked> 是非題</label>
          <label class="filter-tab active" style="cursor:pointer"><input type="checkbox" value="fill_blank" checked> 填充題</label>
          <label class="filter-tab active" style="cursor:pointer"><input type="checkbox" value="calculation" checked> 計算題</label>
          <label class="filter-tab active" style="cursor:pointer"><input type="checkbox" value="matching" checked> 配合題</label>
          <label class="filter-tab active" style="cursor:pointer"><input type="checkbox" value="ordering" checked> 排序題</label>
        </div>
        <div style="text-align:center">
          <button class="btn btn-primary" onclick="App.startRandomExam(${allQuestions.length})">開始練習</button>
        </div>
      </div>
    `;

    // Store all questions for random exam
    this._allQuestions = allQuestions;
  },

  startRandomExam(totalAvailable) {
    const count = parseInt(document.getElementById('randomCount').value);
    const checkedTypes = Array.from(document.querySelectorAll('input[type=checkbox]:checked')).map(c => c.value);
    let pool = this._allQuestions.filter(q => checkedTypes.includes(q.type));
    if (pool.length === 0) pool = this._allQuestions;
    
    const questions = this.shuffle(pool).slice(0, Math.min(count, pool.length));
    
    this.currentExam = {
      type: 'random',
      examTitle: `隨機練習 ${questions.length} 題`,
      questions: questions,
      answers: {},
      startTime: Date.now(),
      showExplanations: false,
      isTimed: false
    };
    
    this.renderExamPage(document.getElementById('app'));
  },

  // ===== Wrong Book =====
  async renderWrongBook(app) {
    const wrongBook = this.getWrongBook();
    const allQuestions = await this.loadAllQuestions();
    const wrongQuestions = allQuestions.filter(q => wrongBook.includes(q.id));

    app.innerHTML = `
      <header class="app-header">
        <button class="nav-back" onclick="App.navigate('home')">← 返回首頁</button>
        <h1>錯題本</h1>
        <div class="subtitle">${wrongQuestions.length} 題</div>
      </header>
      <div class="container">
    `;

    if (wrongQuestions.length === 0) {
      app.querySelector('.container').innerHTML = `
        <div class="empty-state">
          <div class="icon">🎯</div>
          <h3>目前沒有錯題</h3>
          <p>繼續練習，答錯的題目會自動加入這裡</p>
        </div>
        <div style="text-align:center;margin:1rem 0">
          <button class="btn btn-primary" onclick="App.navigate('home')">返回首頁</button>
        </div>
      `;
      return;
    }

    let html = `<div class="hero-section"><h2>錯題複習</h2><p>以下為你曾答錯的題目</p></div>`;
    html += `<div style="text-align:center;margin:1rem 0">
      <button class="btn btn-accent" onclick="App.startWrongBookExam()">開始錯題練習</button>
      <button class="btn btn-danger" onclick="App.clearWrongBook()">清空錯題本</button>
    </div>`;
    html += `<div class="question-list">`;
    wrongQuestions.forEach((q, i) => {
      html += this.renderQuestionHTML(q, i);
    });
    html += `</div></div>`;
    
    app.querySelector('.container').innerHTML = html;
    this.attachQuestionHandlers();
    // Show all explanations in wrong book
    this.currentExam = { showExplanations: true, answers: {} };
  },

  startWrongBookExam() {
    const wrongBook = this.getWrongBook();
    // Need to reload questions - use cached
    const wrongQuestions = [];
    for (const unit of this.units) {
      const data = this.questionCache[unit.id];
      if (data && data.questions) {
        data.questions.forEach(q => {
          if (wrongBook.includes(q.id)) wrongQuestions.push(q);
        });
      }
    }
    if (wrongQuestions.length === 0) return;
    
    this.currentExam = {
      type: 'wrongbook',
      examTitle: `錯題練習 ${wrongQuestions.length} 題`,
      questions: this.shuffle(wrongQuestions),
      answers: {},
      startTime: Date.now(),
      showExplanations: false,
      isTimed: false
    };
    this.renderExamPage(document.getElementById('app'));
  },

  clearWrongBook() {
    if (confirm('確定要清空錯題本嗎？')) {
      localStorage.removeItem('osh_wrongbook');
      this.renderWrongBook(document.getElementById('app'));
    }
  },

  // ===== Exam Page Renderer =====
  renderExamPage(app) {
    const exam = this.currentExam;
    if (!exam) { this.navigate('home'); return; }

    let headerTitle = exam.examTitle || `第 ${exam.unitNumber} 單元`;
    if (exam.unitTitle) headerTitle = `第 ${exam.unitNumber} 單元：${exam.unitTitle}`;

    app.innerHTML = `
      <header class="app-header">
        <button class="nav-back" onclick="App.confirmExit()">← 返回</button>
        <h1>${headerTitle}</h1>
        <div class="subtitle">${exam.questions.length} 題 ${exam.isTimed ? '· 限時 100 分鐘' : ''}</div>
      </header>
      <div class="container">
        <div class="exam-info-bar">
          <div class="exam-title-text">${exam.isTimed ? '⏱ 模擬考模式' : '📚 練習模式'}</div>
          <div class="timer" id="examTimer" style="${exam.isTimed ? '' : 'display:none'}">100:00</div>
          <div class="progress-text">已答 <span id="answeredCount">0</span> / ${exam.questions.length}</div>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
          <div class="review-toggle">
            <input type="checkbox" id="instantReview" ${exam.type === 'unit' || exam.type === 'random' ? 'checked' : ''}>
            <label for="instantReview">即時顯示答案與解析</label>
          </div>
        </div>
        <div class="question-list" id="questionList"></div>
        <div class="exam-actions">
          <button class="btn btn-success" onclick="App.submitExam()">交卷計分</button>
        </div>
      </div>
    `;

    // Render questions
    const listEl = document.getElementById('questionList');
    let html = '';
    exam.questions.forEach((q, i) => {
      html += this.renderQuestionHTML(q, i);
    });
    listEl.innerHTML = html;

    this.attachQuestionHandlers();

    // Update answered count
    this.updateAnsweredCount();

    // Start timer if timed
    if (exam.isTimed) this.startTimer();

    // Instant review toggle
    document.getElementById('instantReview').addEventListener('change', (e) => {
      exam.instantReview = e.target.checked;
    });
    exam.instantReview = document.getElementById('instantReview').checked;
  },

  // ===== Question HTML Renderer =====
  renderQuestionHTML(q, index) {
    const typeLabels = {
      'single_choice': '單選題',
      'multiple_choice': '複選題',
      'true_false': '是非題',
      'fill_blank': '填充題',
      'calculation': '計算題',
      'matching': '配合題',
      'ordering': '排序題'
    };
    const typeClass = (q.type || 'single').replace('_', '_');
    
    let body = '';
    
    if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'true_false') {
      const isMultiple = q.type === 'multiple_choice';
      body = `<ul class="options-list" data-qid="${q.id}" data-type="${q.type}">`;
      q.options.forEach(opt => {
        body += `<li class="option-item" data-option="${opt.id}" onclick="App.selectOption('${q.id}','${opt.id}',${isMultiple})">
          <span class="option-label">${opt.id}</span>
          <span class="option-text">${opt.text}</span>
        </li>`;
      });
      body += `</ul>`;
    } else if (q.type === 'fill_blank') {
      body = `<div data-qid="${q.id}" data-type="fill_blank">
        <input type="text" class="fill-input" placeholder="請輸入答案" oninput="App.setFillAnswer('${q.id}',this.value)" data-qid="${q.id}">
      </div>`;
    } else if (q.type === 'calculation') {
      const unit = q.answer && q.answer.unit ? q.answer.unit : '';
      body = `<div data-qid="${q.id}" data-type="calculation">
        <div class="calc-input-group">
          <input type="text" class="calc-input" placeholder="請輸入數值" oninput="App.setCalcAnswer('${q.id}',this.value)" data-qid="${q.id}">
          <span class="calc-unit">${unit}</span>
        </div>
      </div>`;
    } else if (q.type === 'matching') {
      body = `<div data-qid="${q.id}" data-type="matching" class="matching-container">`;
      body += `<div class="matching-column"><h4>左欄</h4>`;
      q.leftItems.forEach(item => {
        body += `<div class="match-item" data-side="left" data-id="${item.id}" onclick="App.selectMatch('${q.id}','left','${item.id}')">
          <span class="match-label">${item.id}</span> ${item.text}
        </div>`;
      });
      body += `</div><div class="matching-column"><h4>右欄</h4>`;
      q.rightItems.forEach(item => {
        body += `<div class="match-item" data-side="right" data-id="${item.id}" onclick="App.selectMatch('${q.id}','right','${item.id}')">
          <span class="match-label">${item.id}</span> ${item.text}
        </div>`;
      });
      body += `</div></div>`;
      body += `<div id="match-status-${q.id}" style="font-size:0.82rem;color:var(--text-light);margin-top:0.5rem"></div>`;
    } else if (q.type === 'ordering') {
      const shuffled = q.items ? this.shuffle(q.items.slice()) : [];
      body = `<div data-qid="${q.id}" data-type="ordering" class="ordering-container">`;
      shuffled.forEach((item, i) => {
        body += `<div class="order-item" draggable="true" data-id="${item.id}" data-index="${i}">
          <span class="drag-handle">⠿</span>
          <span class="order-slot">${i+1}</span>
          <span>${item.text}</span>
        </div>`;
      });
      body += `</div>`;
    }

    const explanation = q.explanation ? `<div class="explanation-box" id="exp-${q.id}">
      <div class="ex-label">解析</div>
      <div class="ex-answer" id="ans-${q.id}"></div>
      <div>${q.explanation}</div>
      ${q.references ? `<div class="ex-ref">${q.references.map(r => `<a href="${r.url}" target="_blank">📎 ${r.title}</a>`).join(' · ')}</div>` : ''}
    </div>` : '';

    return `
      <div class="question-card" id="qcard-${q.id}">
        <div class="q-header">
          <span class="q-number">Q${index+1}</span>
          <span class="q-type-badge ${(q.type||'single').replace('_','')}">${typeLabels[q.type] || '單選題'}</span>
          <div class="q-stem">${q.stem || q.question || ''}</div>
        </div>
        ${body}
        ${explanation}
      </div>
    `;
  },

  // ===== Answer Handlers =====
  selectOption(qid, optId, isMultiple) {
    const exam = this.currentExam;
    if (!exam) return;
    
    if (isMultiple) {
      if (!exam.answers[qid]) exam.answers[qid] = [];
      const idx = exam.answers[qid].indexOf(optId);
      if (idx >= 0) exam.answers[qid].splice(idx, 1);
      else exam.answers[qid].push(optId);
    } else {
      exam.answers[qid] = [optId];
    }

    // Update UI
    const list = document.querySelector(`.options-list[data-qid="${qid}"]`);
    if (list) {
      list.querySelectorAll('.option-item').forEach(el => {
        el.classList.remove('selected');
        const oid = el.dataset.option;
        if (exam.answers[qid] && exam.answers[qid].includes(oid)) {
          el.classList.add('selected');
        }
      });
    }

    this.updateAnsweredCount();

    if (exam.instantReview || exam.showExplanations) {
      this.showQuestionResult(qid);
    }
  },

  setFillAnswer(qid, value) {
    const exam = this.currentExam;
    if (!exam) return;
    exam.answers[qid] = value.trim();
    this.updateAnsweredCount();
    if (exam.instantReview) this.showQuestionResult(qid);
  },

  setCalcAnswer(qid, value) {
    const exam = this.currentExam;
    if (!exam) return;
    exam.answers[qid] = value.trim();
    this.updateAnsweredCount();
    if (exam.instantReview) this.showQuestionResult(qid);
  },

  selectMatch(qid, side, itemId) {
    const exam = this.currentExam;
    if (!exam) return;
    
    if (!exam.answers[qid]) exam.answers[qid] = { left: null, right: null, pairs: [] };
    const ans = exam.answers[qid];
    
    if (side === 'left') {
      ans.left = ans.left === itemId ? null : itemId;
    } else {
      ans.right = ans.right === itemId ? null : itemId;
    }

    // If both selected, create a pair
    if (ans.left && ans.right) {
      // Remove existing pair with same left
      ans.pairs = ans.pairs.filter(p => p.left !== ans.left && p.right !== ans.right);
      ans.pairs.push({ left: ans.left, right: ans.right });
      
      const status = document.getElementById(`match-status-${qid}`);
      if (status) {
        status.textContent = `已配對：${ans.pairs.length} 組`;
      }
      
      ans.left = null;
      ans.right = null;
    }

    // Update UI
    const container = document.querySelector(`.matching-container[data-qid="${qid}"]`);
    if (container) {
      container.querySelectorAll('.match-item').forEach(el => {
        el.classList.remove('selected-left', 'selected-right');
        const sid = el.dataset.side;
        const id = el.dataset.id;
        if (sid === 'left' && ans.left === id) el.classList.add('selected-left');
        if (sid === 'right' && ans.right === id) el.classList.add('selected-right');
      });
    }

    if (ans.pairs && ans.pairs.length > 0) this.updateAnsweredCount();

    if (exam.instantReview && ans.pairs && ans.pairs.length > 0) {
      // Only check when all pairs made
      const q = exam.questions.find(qq => qq.id === qid);
      if (q && q.leftItems && ans.pairs.length >= q.leftItems.length) {
        this.showQuestionResult(qid);
      }
    }
  },

  // ===== Drag & Drop for Ordering =====
  attachQuestionHandlers() {
    const orderItems = document.querySelectorAll('.order-item');
    let draggedItem = null;
    
    orderItems.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        // Update order slots and save
        const container = item.parentElement;
        const items = container.querySelectorAll('.order-item');
        const qid = container.dataset.qid;
        const order = [];
        items.forEach((it, i) => {
          it.querySelector('.order-slot').textContent = i + 1;
          order.push(it.dataset.id);
        });
        if (this.currentExam) {
          this.currentExam.answers[qid] = order;
          this.updateAnsweredCount();
          if (this.currentExam.instantReview) this.showQuestionResult(qid);
        }
      });
      
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const container = item.parentElement;
        const afterElement = this.getDragAfterElement(container, e.clientY);
        if (afterElement == null) {
          container.appendChild(draggedItem);
        } else if (draggedItem) {
          container.insertBefore(draggedItem, afterElement);
        }
      });
    });
  },

  getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.order-item:not(.dragging)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      }
      return closest;
    }, { offset: -Infinity }).element;
  },

  // ===== Show Question Result =====
  showQuestionResult(qid) {
    const exam = this.currentExam;
    if (!exam) return;
    const q = exam.questions.find(qq => qq.id === qid) || (this._allQuestions ? this._allQuestions.find(qq => qq.id === qid) : null);
    if (!q) return;

    const userAnswer = exam.answers[qid];
    if (!userAnswer || (Array.isArray(userAnswer) && userAnswer.length === 0)) return;

    const isCorrect = this.checkAnswer(q, userAnswer);
    
    // Update option styling
    if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'true_false') {
      const list = document.querySelector(`.options-list[data-qid="${qid}"]`);
      if (list) {
        list.querySelectorAll('.option-item').forEach(el => {
          el.classList.remove('correct', 'wrong');
          const oid = el.dataset.option;
          if (q.answer.includes(oid)) {
            el.classList.add('correct');
          } else if (userAnswer.includes(oid) && !q.answer.includes(oid)) {
            el.classList.add('wrong');
          }
        });
      }
    } else if (q.type === 'fill_blank' || q.type === 'calculation') {
      const input = document.querySelector(`input[data-qid="${qid}"]`);
      if (input) {
        input.classList.remove('correct', 'wrong');
        input.classList.add(isCorrect ? 'correct' : 'wrong');
      }
    } else if (q.type === 'matching') {
      const container = document.querySelector(`.matching-container[data-qid="${qid}"]`);
      if (container) {
        container.querySelectorAll('.match-item').forEach(el => {
          el.classList.remove('matched-correct', 'matched-wrong');
        });
        if (userAnswer.pairs) {
          userAnswer.pairs.forEach(pair => {
            const correct = q.answer.some(a => a.left === pair.left && a.right === pair.right);
            const leftEl = container.querySelector(`.match-item[data-side="left"][data-id="${pair.left}"]`);
            const rightEl = container.querySelector(`.match-item[data-side="right"][data-id="${pair.right}"]`);
            if (leftEl) leftEl.classList.add(correct ? 'matched-correct' : 'matched-wrong');
            if (rightEl) rightEl.classList.add(correct ? 'matched-correct' : 'matched-wrong');
          });
        }
      }
    } else if (q.type === 'ordering') {
      const container = document.querySelector(`.ordering-container[data-qid="${qid}"]`);
      if (container) {
        const items = container.querySelectorAll('.order-item');
        items.forEach((el, i) => {
          el.classList.remove('correct', 'wrong');
          const correctOrder = q.answer[i];
          if (el.dataset.id === correctOrder) {
            el.classList.add('correct');
          } else {
            el.classList.add('wrong');
          }
        });
      }
    }

    // Show explanation
    const expBox = document.getElementById(`exp-${qid}`);
    if (expBox) {
      expBox.classList.add('show');
      const ansEl = document.getElementById(`ans-${qid}`);
      if (ansEl) {
        let ansText = '';
        if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'true_false') {
          ansText = '正確答案：' + q.answer.join(', ');
        } else if (q.type === 'fill_blank') {
          ansText = '正確答案：' + (Array.isArray(q.answer) ? q.answer.join(' 或 ') : q.answer);
        } else if (q.type === 'calculation') {
          ansText = '正確答案：' + q.answer.value + (q.answer.unit || '');
        } else if (q.type === 'matching') {
          ansText = '正確配對：' + q.answer.map(a => `${a.left}↔${a.right}`).join(', ');
        } else if (q.type === 'ordering') {
          ansText = '正確順序：' + q.answer.join(' → ');
        }
        ansEl.textContent = ansText + (isCorrect ? ' ✓' : ' ✗');
        ansEl.classList.toggle('wrong-answer', !isCorrect);
      }
    }

    // Track wrong answers
    if (!isCorrect) {
      this.addWrongAnswer(qid);
    } else {
      this.removeWrongAnswer(qid);
    }
  },

  // ===== Answer Checking =====
  checkAnswer(q, userAnswer) {
    if (!userAnswer) return false;
    
    if (q.type === 'single_choice' || q.type === 'true_false') {
      return Array.isArray(userAnswer) && userAnswer.length === 1 && q.answer.includes(userAnswer[0]);
    } else if (q.type === 'multiple_choice') {
      if (!Array.isArray(userAnswer)) return false;
      const sorted1 = [...userAnswer].sort().join(',');
      const sorted2 = [...q.answer].sort().join(',');
      return sorted1 === sorted2;
    } else if (q.type === 'fill_blank') {
      if (typeof userAnswer !== 'string') return false;
      const normalized = userAnswer.trim().toLowerCase();
      if (Array.isArray(q.answer)) {
        return q.answer.some(a => a.trim().toLowerCase() === normalized);
      }
      return q.answer.trim().toLowerCase() === normalized;
    } else if (q.type === 'calculation') {
      if (typeof userAnswer !== 'string') return false;
      const val = parseFloat(userAnswer);
      if (isNaN(val)) return false;
      const tolerance = q.answer.tolerance || 0.01;
      return Math.abs(val - q.answer.value) <= tolerance;
    } else if (q.type === 'matching') {
      if (!userAnswer.pairs) return false;
      if (userAnswer.pairs.length !== q.answer.length) return false;
      return userAnswer.pairs.every(p => q.answer.some(a => a.left === p.left && a.right === p.right));
    } else if (q.type === 'ordering') {
      if (!Array.isArray(userAnswer)) return false;
      if (userAnswer.length !== q.answer.length) return false;
      return userAnswer.every((v, i) => v === q.answer[i]);
    }
    return false;
  },

  // ===== Submit Exam =====
  submitExam() {
    const exam = this.currentExam;
    if (!exam) return;
    
    const unanswered = exam.questions.filter(q => !exam.answers[q.id] || (Array.isArray(exam.answers[q.id]) && exam.answers[q.id].length === 0)).length;
    
    if (unanswered > 0) {
      if (!confirm(`還有 ${unanswered} 題未作答，確定要交卷嗎？`)) return;
    }

    // Stop timer
    if (this.timer) { clearInterval(this.timer); this.timer = null; }

    let correct = 0;
    let wrong = 0;
    let skipped = 0;

    exam.questions.forEach(q => {
      const userAnswer = exam.answers[q.id];
      if (!userAnswer || (Array.isArray(userAnswer) && userAnswer.length === 0) || (userAnswer.pairs && userAnswer.pairs.length === 0)) {
        skipped++;
      } else {
        if (this.checkAnswer(q, userAnswer)) {
          correct++;
        } else {
          wrong++;
          this.addWrongAnswer(q.id);
        }
      }
    });

    const total = exam.questions.length;
    const score = Math.round((correct / total) * 100);
    const passed = score >= 60;

    // Save progress
    if (exam.type === 'unit') {
      this.saveUnitProgress(exam.unitId, { total, answered: correct + wrong, correct });
    }

    // Show results
    this.renderResultsPage(document.getElementById('app'), {
      title: exam.examTitle || `第 ${exam.unitNumber} 單元`,
      score, correct, wrong, skipped, total, passed,
      exam: exam
    });

    // Show all explanations
    exam.questions.forEach(q => this.showQuestionResult(q.id));
  },

  confirmExit() {
    if (this.currentExam && Object.keys(this.currentExam.answers).length > 0) {
      if (!confirm('確定要離開嗎？目前的作答將不會保留。')) return;
    }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.currentExam = null;
    this.navigate('home');
  },

  // ===== Results Page =====
  renderResultsPage(app, result) {
    const r = result;
    app.innerHTML = `
      <header class="app-header">
        <button class="nav-back" onclick="App.navigate('home')">← 返回首頁</button>
        <h1>測驗結果</h1>
      </header>
      <div class="container">
        <div class="results-container">
          <h2>${r.title}</h2>
          <div class="score-circle ${r.passed ? 'pass' : 'fail'}">
            <div class="score-num">${r.score}</div>
            <div class="score-label">${r.passed ? '及格' : '不及格'}</div>
          </div>
          <div class="results-breakdown">
            <div class="breakdown-item"><div class="bd-num" style="color:var(--success)">${r.correct}</div><div class="bd-label">答對</div></div>
            <div class="breakdown-item"><div class="bd-num" style="color:var(--danger)">${r.wrong}</div><div class="bd-label">答錯</div></div>
            <div class="breakdown-item"><div class="bd-num" style="color:var(--text-light)">${r.skipped}</div><div class="bd-label">未答</div></div>
            <div class="breakdown-item"><div class="bd-num" style="color:var(--primary)">${r.total}</div><div class="bd-label">總題數</div></div>
          </div>
          <div class="exam-actions">
            <button class="btn btn-primary" onclick="App.navigate('home')">返回首頁</button>
            <button class="btn btn-outline" onclick="App.reviewExam()">查看答題詳情</button>
          </div>
        </div>
      </div>
    `;
  },

  reviewExam() {
    const exam = this.currentExam;
    if (!exam) { this.navigate('home'); return; }
    exam.showExplanations = true;
    this.renderExamPage(document.getElementById('app'));
    // Show all results
    exam.questions.forEach(q => this.showQuestionResult(q.id));
  },

  // ===== Timer =====
  startTimer() {
    const exam = this.currentExam;
    if (!exam || !exam.duration) return;
    
    const endTime = exam.startTime + exam.duration;
    
    this.timer = setInterval(() => {
      const remaining = endTime - Date.now();
      if (remaining <= 0) {
        clearInterval(this.timer);
        this.timer = null;
        alert('時間到！系統將自動交卷。');
        this.submitExam();
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      const el = document.getElementById('examTimer');
      if (el) {
        el.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        if (remaining < 300000) el.style.color = 'var(--danger)';
      }
    }, 1000);
  },

  updateAnsweredCount() {
    const exam = this.currentExam;
    if (!exam) return;
    const answered = exam.questions.filter(q => {
      const a = exam.answers[q.id];
      if (!a) return false;
      if (Array.isArray(a)) return a.length > 0;
      if (typeof a === 'string') return a.trim().length > 0;
      if (a.pairs) return a.pairs.length > 0;
      return false;
    }).length;
    const el = document.getElementById('answeredCount');
    if (el) el.textContent = answered;
  },

  // ===== localStorage =====
  getProgress() {
    try { return JSON.parse(localStorage.getItem('osh_progress') || '{}'); }
    catch(e) { return {}; }
  },

  saveProgress(p) {
    try { localStorage.setItem('osh_progress', JSON.stringify(p)); } catch(e) {}
  },

  saveUnitProgress(unitId, data) {
    const p = this.getProgress();
    p[unitId] = data;
    this.saveProgress(p);
  },

  getWrongBook() {
    try { return JSON.parse(localStorage.getItem('osh_wrongbook') || '[]'); }
    catch(e) { return []; }
  },

  addWrongAnswer(qid) {
    const wb = this.getWrongBook();
    if (!wb.includes(qid)) {
      wb.push(qid);
      try { localStorage.setItem('osh_wrongbook', JSON.stringify(wb)); } catch(e) {}
    }
  },

  removeWrongAnswer(qid) {
    const wb = this.getWrongBook();
    const idx = wb.indexOf(qid);
    if (idx >= 0) {
      wb.splice(idx, 1);
      try { localStorage.setItem('osh_wrongbook', JSON.stringify(wb)); } catch(e) {}
    }
  },

  // ===== Utility =====
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  // ===== Results Route =====
  renderResults(app) {
    if (this.currentExam) {
      this.reviewExam();
    } else {
      this.navigate('home');
    }
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => App.init());
