// Client-side API wrapper for the Splitwise Proxy Server
const API = {
  // Key storage helpers
  getToken() {
    return localStorage.getItem('splitwise_token') || '';
  },

  setToken(token) {
    localStorage.setItem('splitwise_token', token.trim());
  },

  clearToken() {
    localStorage.removeItem('splitwise_token');
  },

  hasToken() {
    return !!this.getToken();
  },

  // Base request handler
  async request(endpoint, options = {}) {
    const headers = { ...options.headers };
    
    // Inject the personal token if the user has configured it in the UI
    const token = this.getToken();
    if (token) {
      headers['X-Splitwise-Token'] = token;
    }

    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(endpoint, config);
      
      // Auto-handle 401 Unauthorized (missing or invalid API key)
      if (response.status === 401) {
        // Dispatch custom event so app.js can catch it and display the API key modal
        window.dispatchEvent(new CustomEvent('splitwise-unauthorized'));
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        // Construct detailed error message
        const errorMsg = data.error || data.message || `API error (${response.status})`;
        throw new Error(errorMsg);
      }

      return data;
    } catch (error) {
      console.error(`Fetch error at ${endpoint}:`, error);
      throw error;
    }
  },

  // Endpoints wrappers
  async getCurrentUser() {
    return this.request('/api/user');
  },

  async getGroups() {
    return this.request('/api/groups');
  },

  async getFriends() {
    return this.request('/api/friends');
  },

  async getCategories() {
    return this.request('/api/categories');
  },

  async getExpenses(params = {}) {
    const searchParams = new URLSearchParams();
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        searchParams.append(key, params[key]);
      }
    });

    const queryString = searchParams.toString();
    const endpoint = `/api/expenses${queryString ? '?' + queryString : ''}`;
    return this.request(endpoint);
  },

  async getExpense(id) {
    return this.request(`/api/expenses/${id}`);
  },

  async createExpense(expenseData) {
    return this.request('/api/expenses', {
      method: 'POST',
      body: expenseData
    });
  },

  async updateExpense(id, expenseData) {
    return this.request(`/api/expenses/${id}`, {
      method: 'POST',
      body: expenseData
    });
  },

  async deleteExpense(id) {
    return this.request(`/api/expenses/${id}/delete`, {
      method: 'POST'
    });
  }
};
