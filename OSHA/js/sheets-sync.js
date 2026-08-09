/**
 * Google Sheets 雲端同步模組
 * 透過 Google Apps Script Web App 讀寫 Google Sheet
 */

const Sync = {
  apiUrl: null,
  currentUser: null,
  initialized: false,
  _apiReady: false,
  token: null,  // 登入後取得的 token

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    const config = window.sheetsConfig;
    if (!config || config.url === '???') {
      console.log('Google Sheets 未設定，使用本地儲存模式');
      return;
    }

    this.apiUrl = config.url;
    this._apiReady = true;
    console.log('Google Sheets 同步已就緒');
  },

  // 是否已設定 API（不含登入狀態）
  get isReady() {
    return this._apiReady;
  },

  // 是否已登入且可同步
  isSyncActive() {
    return this._apiReady && !!this.token;
  },

  // 呼叫 API
  async _call(action, data = {}) {
    if (!this.apiUrl) return { success: false, error: 'API 未設定' };
    
    const payload = { action, ...data };
    if (this.token) payload.token = this.token;

    try {
      const resp = await fetch(this.apiUrl, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        muteHttpExceptions: true
      });
      const result = await resp.json();
      return result;
    } catch(e) {
      console.error('API 呼叫失敗:', e);
      return { success: false, error: '網路連線失敗，請檢查網路後重試' };
    }
  },

  // 註冊
  async register(email, password) {
    const result = await this._call('register', { email, password });
    if (result.success) {
      this.token = result.token;
      this.currentUser = { email };
      await this.loadCloudData();
      return { success: true };
    }
    return { success: false, error: result.error || '註冊失敗' };
  },

  // 登入
  async login(email, password) {
    const result = await this._call('login', { email, password });
    if (result.success) {
      this.token = result.token;
      this.currentUser = { email };
      await this.loadCloudData();
      return { success: true };
    }
    return { success: false, error: result.error || '登入失敗' };
  },

  // 登出
  async logout() {
    this.token = null;
    this.currentUser = null;
  },

  // 載入雲端資料
  async loadCloudData() {
    if (!this.isSyncActive()) return;
    const result = await this._call('getData');
    if (result.success && result.data) {
      // 合併雲端錯題本
      if (result.data.wrongBook) {
        try {
          const cloudWB = JSON.parse(result.data.wrongBook || '[]');
          const localWB = JSON.parse(localStorage.getItem('osh_wrongbook') || '[]');
          // 合併，取聯集
          const merged = [...new Set([...localWB, ...cloudWB])];
          localStorage.setItem('osh_wrongbook', JSON.stringify(merged));
        } catch(e) {}
      }
      // 合併雲端進度
      if (result.data.progress) {
        try {
          const cloudProg = JSON.parse(result.data.progress || '{}');
          const localProg = JSON.parse(localStorage.getItem('osh_progress') || '{}');
          for (const key in cloudProg) {
            if (!localProg[key] || (cloudProg[key].answered || 0) > (localProg[key].answered || 0)) {
              localProg[key] = cloudProg[key];
            }
          }
          localStorage.setItem('osh_progress', JSON.stringify(localProg));
        } catch(e) {}
      }
      console.log('雲端資料同步完成');
    }
  },

  // 儲存錯題本到雲端
  async saveWrongBook(wrongBook) {
    if (!this.isSyncActive()) return;
    await this._call('saveWrongBook', { 
      wrongBook: JSON.stringify(wrongBook) 
    });
  },

  // 儲存進度到雲端
  async saveProgress(progress) {
    if (!this.isSyncActive()) return;
    await this._call('saveProgress', { 
      progress: JSON.stringify(progress) 
    });
  },

  // 取得使用者顯示名稱
  getDisplayName() {
    if (this.currentUser && this.currentUser.email) {
      return this.currentUser.email.split('@')[0];
    }
    return '使用者';
  }
};

window.Sync = Sync;
