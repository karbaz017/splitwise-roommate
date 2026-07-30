// Application Core State and UI Controller
class SplitwiseApp {
  constructor() {
    this.state = {
      currentUser: null,
      groups: [],
      friends: [],
      categories: [],
      expenses: [],
      currentPage: 1,
      totalPages: 1,
      limit: 15,
      splitMode: 'equal', // 'equal' | 'custom'
      expenseParticipants: [], // { user_id, name, avatar, paid_share, owed_share, is_creator }
      activeTab: 'dashboard',
      categoryChart: null,
      filters: {
        search: '',
        group_id: '',
        friend_id: ''
      }
    };

    // Category mapping to Lucide Icons
    this.iconMap = {
      'entertainment': 'clapperboard',
      'games': 'gamepad-2',
      'movies': 'film',
      'music': 'music',
      'sports': 'trophy',
      'food and drink': 'utensils',
      'dining out': 'utensils-cross',
      'groceries': 'shopping-cart',
      'liquor': 'glass-water',
      'utilities': 'bolt',
      'electricity': 'zap',
      'heat/gas': 'flame',
      'water': 'droplets',
      'tv/phone/internet': 'wifi',
      'rent': 'home',
      'household supplies': 'sofa',
      'furniture': 'anvil',
      'maintenance': 'wrench',
      'travel': 'plane',
      'taxi': 'car',
      'parking': 'square-parking',
      'bus/train': 'bus',
      'car': 'car',
      'insurance': 'shield-check',
      'medical': 'pill',
      'clothing': 'shirt',
      'gifts': 'gift',
      'payment': 'hand-coins', // Settlement icon
      'other': 'receipt'
    };
  }

  // Initialize application
  async init() {
    this.bindEvents();
    
    // Check if token exists in localStorage or server env
    this.showLoadingIndicator(true);
    try {
      // Test authentication by fetching current user
      const userData = await API.getCurrentUser();
      this.state.currentUser = userData.user;
      this.showLoadingIndicator(false);
      this.setConnectionStatus('connected');
      
      // Load cache if available, then fetch fresh data
      this.loadCachedData();
      await this.loadAllBaseData();
      this.render();
    } catch (error) {
      this.showLoadingIndicator(false);
      console.error("Initialization failed:", error);
      if (error.message.includes('unauthorized') || error.message.includes('401')) {
        this.setConnectionStatus('disconnected');
        this.openApiKeyModal();
      } else {
        this.showToast("Could not connect to backend server.", "error");
      }
    }
  }

  // Bind UI Events
  bindEvents() {
    // Tab switching
    document.querySelectorAll('.nav-item').forEach(button => {
      button.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // Handle Splitwise unauthorized custom event
    window.addEventListener('splitwise-unauthorized', () => {
      this.setConnectionStatus('disconnected');
      this.openApiKeyModal();
    });

    // Populate key input field on Settings tab load
    const keyInput = document.getElementById('api-key-input');
    if (keyInput) {
      keyInput.value = API.getToken();
    }
  }

  // Connection status indicator
  setConnectionStatus(status) {
    const indicator = document.getElementById('connection-indicator');
    const statusText = indicator.querySelector('.status-text');
    
    indicator.className = `connection-status ${status}`;
    if (status === 'connected') {
      statusText.textContent = 'Connected';
    } else if (status === 'disconnected') {
      statusText.textContent = 'Setup API Key';
    } else {
      statusText.textContent = 'Connecting...';
    }
  }

  // Show global loader states
  showLoadingIndicator(show) {
    const loaders = ['metric-total-balance', 'metric-you-owe', 'metric-you-are-owed'];
    loaders.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (show) {
          el.classList.add('loading-shimmer');
        } else {
          el.classList.remove('loading-shimmer');
        }
      }
    });
  }

  // Fetch groups, friends, categories, and recent transactions
  async loadAllBaseData() {
    try {
      const [groupsData, friendsData, categoriesData] = await Promise.all([
        API.getGroups(),
        API.getFriends(),
        API.getCategories()
      ]);

      this.state.groups = groupsData.groups || [];
      this.state.friends = friendsData.friends || [];
      this.state.categories = categoriesData.categories || [];

      // Save to localStorage cache
      localStorage.setItem('splitwise_cache_groups', JSON.stringify(this.state.groups));
      localStorage.setItem('splitwise_cache_friends', JSON.stringify(this.state.friends));
      localStorage.setItem('splitwise_cache_categories', JSON.stringify(this.state.categories));
      
      // Populate select elements
      this.populateFilterDropdowns();
      this.populateCategoryDropdown();
    } catch (error) {
      console.error("Failed to load base data:", error);
      this.showToast("Failed to sync Splitwise metadata.", "error");
    }
  }

  // Load cached metadata for faster startup
  loadCachedData() {
    try {
      const cachedGroups = localStorage.getItem('splitwise_cache_groups');
      const cachedFriends = localStorage.getItem('splitwise_cache_friends');
      const cachedCategories = localStorage.getItem('splitwise_cache_categories');

      if (cachedGroups) this.state.groups = JSON.parse(cachedGroups);
      if (cachedFriends) this.state.friends = JSON.parse(cachedFriends);
      if (cachedCategories) this.state.categories = JSON.parse(cachedCategories);

      this.populateFilterDropdowns();
      this.populateCategoryDropdown();
    } catch (e) {
      console.warn("Failed to load cached metadata", e);
    }
  }

  // Populate Groups and Friends Filters
  populateFilterDropdowns() {
    const groupSelect = document.getElementById('filter-group');
    const friendSelect = document.getElementById('filter-friend');
    const expenseGroup = document.getElementById('exp-group');
    const settleFriend = document.getElementById('settle-friend');
    const expenseAddFriend = document.getElementById('add-friend-to-expense');

    if (!groupSelect) return;

    // Reset selects
    groupSelect.innerHTML = '<option value="">All Groups</option>';
    expenseGroup.innerHTML = '<option value="">No Group (Individual Split)</option>';
    friendSelect.innerHTML = '<option value="">All Friends</option>';
    settleFriend.innerHTML = '<option value="">-- Select Friend --</option>';
    expenseAddFriend.innerHTML = '<option value="">-- Choose Friend --</option>';

    // Groups
    this.state.groups.forEach(g => {
      // Exclude non-active groups
      const option = `<option value="${g.id}">${g.name}</option>`;
      groupSelect.insertAdjacentHTML('beforeend', option);
      expenseGroup.insertAdjacentHTML('beforeend', option);
    });

    // Friends
    this.state.friends.forEach(f => {
      const name = `${f.first_name || ''} ${f.last_name || ''}`.trim();
      const option = `<option value="${f.id}">${name}</option>`;
      friendSelect.insertAdjacentHTML('beforeend', option);
      settleFriend.insertAdjacentHTML('beforeend', option);
      expenseAddFriend.insertAdjacentHTML('beforeend', option);
    });
  }

  // Populate Categories in Select list
  populateCategoryDropdown() {
    const select = document.getElementById('exp-category');
    if (!select) return;

    select.innerHTML = '';
    
    // Splitwise categorizes items into subcategories grouped by major categories
    this.state.categories.forEach(cat => {
      const groupOpt = document.createElement('optgroup');
      groupOpt.label = cat.name;

      if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
          const opt = document.createElement('option');
          opt.value = sub.id;
          opt.textContent = sub.name;
          groupOpt.appendChild(opt);
        });
      } else {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        groupOpt.appendChild(opt);
      }

      select.appendChild(groupOpt);
    });
  }

  // Render Page Content
  render() {
    this.renderUserProfile();
    this.renderBalances();
    this.renderDashboard();
    this.renderGroups();
    this.renderFriends();
    lucide.createIcons();
  }

  // Render User details in sidebar
  renderUserProfile() {
    const profileContainer = document.getElementById('user-profile');
    if (!profileContainer || !this.state.currentUser) return;

    const u = this.state.currentUser;
    const avatar = u.picture?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    
    profileContainer.innerHTML = `
      <img src="${avatar}" alt="Avatar" class="profile-avatar">
      <div class="profile-info">
        <span class="profile-name">${u.first_name || ''} ${u.last_name || ''}</span>
        <span class="profile-email">${u.email || ''}</span>
      </div>
    `;
  }

  // Calculate and Render Balances
  renderBalances() {
    let totalBalance = 0;
    let youOwe = 0;
    let youAreOwed = 0;

    this.state.friends.forEach(friend => {
      if (friend.balance && friend.balance.length > 0) {
        friend.balance.forEach(bal => {
          const amount = parseFloat(bal.amount);
          totalBalance += amount;
          if (amount < 0) {
            youOwe += Math.abs(amount);
          } else if (amount > 0) {
            youAreOwed += amount;
          }
        });
      }
    });

    const formatCurrency = (amount) => {
      const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
      return formatted;
    };

    const totalEl = document.getElementById('metric-total-balance');
    const youOweEl = document.getElementById('metric-you-owe');
    const youAreOwedEl = document.getElementById('metric-you-are-owed');
    const balanceDescEl = document.getElementById('metric-balance-desc');

    if (totalEl) totalEl.textContent = formatCurrency(totalBalance);
    if (youOweEl) youOweEl.textContent = formatCurrency(youOwe);
    if (youAreOwedEl) youAreOwedEl.textContent = formatCurrency(youAreOwed);

    // Apply color styling to net balance card
    const netCard = document.querySelector('.balance-net');
    if (netCard) {
      netCard.classList.remove('positive', 'negative');
      if (totalBalance > 0) {
        netCard.classList.add('positive');
        balanceDescEl.textContent = 'Overall you are owed';
      } else if (totalBalance < 0) {
        netCard.classList.add('negative');
        balanceDescEl.textContent = 'Overall you owe money';
      } else {
        balanceDescEl.textContent = 'You are fully settled up!';
      }
    }
  }

  // Tab switcher
  switchTab(tabId) {
    this.state.activeTab = tabId;
    
    // Update Sidebar
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    // Update Panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `${tabId}-panel`);
    });

    // Trigger tab specific loads
    if (tabId === 'dashboard') {
      this.renderDashboard();
    } else if (tabId === 'expenses') {
      this.loadExpensesList();
    }
  }

  // Dashboard Loader & Render
  async renderDashboard() {
    const activityList = document.getElementById('recent-activity-list');
    if (!activityList) return;

    try {
      // Fetch recent 10 expenses for activity and chart
      const expensesData = await API.getExpenses({ limit: 40 });
      const expenses = expensesData.expenses || [];

      // Render recent activity list
      if (expenses.length === 0) {
        activityList.innerHTML = `
          <div class="no-chart-data">
            <i data-lucide="receipt"></i>
            <p>No recent transactions.</p>
          </div>
        `;
        lucide.createIcons();
      } else {
        activityList.innerHTML = '';
        expenses.slice(0, 7).forEach(exp => {
          // Render item
          const costVal = parseFloat(exp.cost);
          const dateFormatted = new Date(exp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          
          // Determine how user is involved
          let involvementText = 'Not involved';
          let involvementColor = '';
          const myShare = exp.users.find(u => u.user_id === this.state.currentUser.id);
          
          if (myShare) {
            const paid = parseFloat(myShare.paid_share);
            const owed = parseFloat(myShare.owed_share);
            const net = paid - owed;
            
            if (exp.payment) {
              if (paid > 0) {
                involvementText = `You settled up (sent $${paid.toFixed(2)})`;
                involvementColor = 'text-success';
              } else {
                involvementText = `You settled up (received $${owed.toFixed(2)})`;
                involvementColor = 'text-success';
              }
            } else {
              if (net > 0) {
                involvementText = `you lent $${net.toFixed(2)}`;
                involvementColor = 'text-success';
              } else if (net < 0) {
                involvementText = `you owe $${Math.abs(net).toFixed(2)}`;
                involvementColor = 'text-danger';
              } else {
                involvementText = 'you paid equally';
                involvementColor = 'text-secondary';
              }
            }
          }

          const categoryName = exp.category?.name || 'Other';
          const icon = this.getCategoryIcon(categoryName);

          const itemHtml = `
            <div class="activity-item">
              <div class="act-info">
                <span class="act-desc">${exp.description}</span>
                <span class="act-meta">${dateFormatted} • ${categoryName}</span>
              </div>
              <div style="text-align: right;">
                <span class="act-amount">$${costVal.toFixed(2)}</span>
                <div class="act-meta ${involvementColor}">${involvementText}</div>
              </div>
            </div>
          `;
          activityList.insertAdjacentHTML('beforeend', itemHtml);
        });
      }

      // Generate Charts
      this.generateSpendingChart(expenses);
    } catch (error) {
      console.error("Dashboard render failed:", error);
      activityList.innerHTML = `<p class="text-danger">Failed to load recent activity.</p>`;
    }
  }

  // Generate spending pie chart based on categories
  generateSpendingChart(expenses) {
    const ctx = document.getElementById('categoryChart');
    const noChartMsg = document.getElementById('no-chart-msg');
    
    if (!ctx) return;

    // Filter out payments (settle up events) and filter positive expenses
    const validExpenses = expenses.filter(e => !e.payment && parseFloat(e.cost) > 0);
    
    if (validExpenses.length === 0) {
      if (this.state.categoryChart) {
        this.state.categoryChart.destroy();
        this.state.categoryChart = null;
      }
      ctx.style.display = 'none';
      noChartMsg.classList.remove('hidden');
      return;
    }

    ctx.style.display = 'block';
    noChartMsg.classList.add('hidden');

    // Aggregate cost by Category
    const categoryTotals = {};
    validExpenses.forEach(exp => {
      const cat = exp.category?.name || 'Other';
      const cost = parseFloat(exp.cost);
      
      // Let's count the current user's actual share (owed share) rather than full expense cost to show real user spending
      const myShare = exp.users.find(u => u.user_id === this.state.currentUser.id);
      const userCost = myShare ? parseFloat(myShare.owed_share) : 0;
      
      if (userCost > 0) {
        categoryTotals[cat] = (categoryTotals[cat] || 0) + userCost;
      }
    });

    const labels = Object.keys(categoryTotals);
    const dataValues = Object.values(categoryTotals);

    if (labels.length === 0) {
      ctx.style.display = 'none';
      noChartMsg.classList.remove('hidden');
      return;
    }

    // Chart.js Configuration
    if (this.state.categoryChart) {
      this.state.categoryChart.destroy();
    }

    const colors = [
      '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', 
      '#8b5cf6', '#ef4444', '#14b8a6', '#06b6d4', '#84cc16'
    ];

    this.state.categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: dataValues,
          backgroundColor: colors.slice(0, labels.length),
          borderColor: '#11131c',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#94a3b8',
              font: {
                family: 'Outfit',
                size: 11
              },
              boxWidth: 12
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const val = context.raw || 0;
                return `${label}: $${val.toFixed(2)}`;
              }
            }
          }
        },
        cutout: '70%'
      }
    });
  }

  // Load and render paginated expenses list
  async loadExpensesList() {
    const listContainer = document.getElementById('expenses-list-container');
    if (!listContainer) return;

    listContainer.innerHTML = `
      <div class="shimmer-item"></div>
      <div class="shimmer-item"></div>
      <div class="shimmer-item"></div>
    `;

    try {
      const offset = (this.state.currentPage - 1) * this.state.limit;
      const apiFilters = {
        limit: this.state.limit,
        offset: offset
      };

      if (this.state.filters.group_id) apiFilters.group_id = this.state.filters.group_id;
      if (this.state.filters.friend_id) apiFilters.friend_id = this.state.filters.friend_id;

      const data = await API.getExpenses(apiFilters);
      let expenses = data.expenses || [];

      // Client-side search filtering (since backend doesn't support regex search easily)
      if (this.state.filters.search) {
        const query = this.state.filters.search.toLowerCase();
        expenses = expenses.filter(e => 
          (e.description && e.description.toLowerCase().includes(query)) ||
          (e.date && e.date.includes(query))
        );
      }

      this.state.expenses = expenses;
      
      // Determine if there are more items
      this.state.totalPages = Math.max(1, Math.ceil((expenses.length === this.state.limit) ? this.state.currentPage + 1 : this.state.currentPage));

      this.renderExpensesList();
    } catch (error) {
      console.error("Expenses load failed:", error);
      listContainer.innerHTML = `<p class="text-danger">Failed to load transactions. Please check your credentials.</p>`;
    }
  }

  // Render expenses list
  renderExpensesList() {
    const listContainer = document.getElementById('expenses-list-container');
    const pageInfo = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');

    if (!listContainer) return;

    if (this.state.expenses.length === 0) {
      listContainer.innerHTML = `
        <div class="dashboard-card" style="text-align: center; padding: 40px; color: var(--text-secondary);">
          <i data-lucide="receipt" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;"></i>
          <p>No transactions found matching the filters.</p>
        </div>
      `;
      pageInfo.textContent = `Page ${this.state.currentPage}`;
      prevBtn.disabled = this.state.currentPage === 1;
      nextBtn.disabled = true;
      lucide.createIcons();
      return;
    }

    listContainer.innerHTML = '';
    this.state.expenses.forEach(exp => {
      const date = new Date(exp.date);
      const dateFormatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const cost = parseFloat(exp.cost).toFixed(2);
      
      // Find my share
      const myShare = exp.users.find(u => u.user_id === this.state.currentUser.id);
      
      let paidText = 'You paid nothing';
      let owedText = 'You owe nothing';
      let netColorClass = 'text-indigo';

      if (myShare) {
        const paidVal = parseFloat(myShare.paid_share);
        const owedVal = parseFloat(myShare.owed_share);
        
        paidText = paidVal > 0 ? `You paid $${paidVal.toFixed(2)}` : 'You paid nothing';
        
        if (exp.payment) {
          if (paidVal > 0) {
            owedText = `You settled up`;
            netColorClass = 'text-success';
          } else {
            owedText = `Received settlement`;
            netColorClass = 'text-success';
          }
        } else {
          const net = paidVal - owedVal;
          if (net > 0) {
            owedText = `You lend $${net.toFixed(2)}`;
            netColorClass = 'text-success';
          } else if (net < 0) {
            owedText = `You owe $${Math.abs(net).toFixed(2)}`;
            netColorClass = 'text-danger';
          } else {
            owedText = 'You are settled';
            netColorClass = 'text-secondary';
          }
        }
      }

      // Map category icon
      const categoryName = exp.category?.name || 'Other';
      const icon = this.getCategoryIcon(categoryName);
      
      // Get group name
      const group = this.state.groups.find(g => g.id === exp.group_id);
      const groupBadge = group ? `<span class="expense-group-badge">${group.name}</span>` : '';

      // Generate splits breakdown layout
      let splitsHtml = '';
      exp.users.forEach(u => {
        const uPaid = parseFloat(u.paid_share);
        const uOwed = parseFloat(u.owed_share);
        
        if (uPaid > 0 || uOwed > 0) {
          const userName = u.user_id === this.state.currentUser.id ? 'You' : `${u.user?.first_name || ''} ${u.user?.last_name || ''}`.trim() || 'Unknown';
          const avatar = u.user?.picture?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
          
          let financialBreakdown = '';
          if (exp.payment) {
            financialBreakdown = uPaid > 0 ? `Sent $${uPaid.toFixed(2)}` : `Received $${uOwed.toFixed(2)}`;
          } else {
            financialBreakdown = `Paid $${uPaid.toFixed(2)} • Owed $${uOwed.toFixed(2)}`;
          }

          splitsHtml += `
            <div class="split-user-row">
              <img class="split-user-avatar" src="${avatar}" alt="">
              <div class="split-user-info">
                <span class="split-username">${userName}</span>
                <span class="split-details">${financialBreakdown}</span>
              </div>
            </div>
          `;
        }
      });

      const expenseCardHtml = `
        <div class="expense-card-wrapper" id="exp-wrapper-${exp.id}">
          <div class="expense-card" onclick="app.toggleExpenseExpand(${exp.id})">
            <div class="expense-cat-icon">
              <i data-lucide="${icon}"></i>
            </div>
            <div class="expense-details">
              <span class="expense-desc">${exp.description}</span>
              <span class="expense-meta">${dateFormatted} ${groupBadge}</span>
            </div>
            <div class="expense-financials">
              <div class="fin-block">
                <span class="fin-label">${paidText}</span>
                <span class="fin-value ${netColorClass}">${owedText}</span>
              </div>
              <div class="fin-block" style="width: 80px;">
                <span class="fin-label">Total Cost</span>
                <span class="fin-value">$${parseFloat(exp.cost).toFixed(2)}</span>
              </div>
            </div>
            <div class="expense-actions" onclick="event.stopPropagation()">
              <button title="Edit Transaction" onclick="app.openEditExpenseModal(${exp.id})">
                <i data-lucide="pencil" style="width: 16px; height: 16px;"></i>
              </button>
              <button class="btn-delete-expense" title="Delete Transaction" onclick="app.deleteExpenseItem(${exp.id})">
                <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
              </button>
            </div>
          </div>
          <div class="expense-expanded-details">
            <h4 style="font-size: 0.85rem; margin-bottom: 12px; color: var(--text-secondary); text-transform: uppercase;">Participants Breakdown</h4>
            <div class="expanded-splits-grid">
              ${splitsHtml}
            </div>
          </div>
        </div>
      `;

      listContainer.insertAdjacentHTML('beforeend', expenseCardHtml);
    });

    // Handle pagination status
    pageInfo.textContent = `Page ${this.state.currentPage}`;
    prevBtn.disabled = this.state.currentPage === 1;
    // Simple pagination: if we fetched full limit, assume there is a next page
    nextBtn.disabled = this.state.expenses.length < this.state.limit;
    
    lucide.createIcons();
  }

  // Toggle expanded details panel
  toggleExpenseExpand(id) {
    const el = document.getElementById(`exp-wrapper-${id}`);
    if (el) {
      el.classList.toggle('expanded');
    }
  }

  // Map category name to icon
  getCategoryIcon(catName) {
    const cleanName = catName.toLowerCase();
    for (const key in this.iconMap) {
      if (cleanName.includes(key)) {
        return this.iconMap[key];
      }
    }
    return 'receipt'; // default fallback icon
  }

  // Handle Search input
  handleSearch(e) {
    this.state.filters.search = e.target.value;
    this.state.currentPage = 1;
    this.loadExpensesList();
  }

  // Handle Group filtering
  handleGroupFilter(e) {
    this.state.filters.group_id = e.target.value;
    this.state.currentPage = 1;
    this.loadExpensesList();
  }

  // Handle Friend filtering
  handleFriendFilter(e) {
    this.state.filters.friend_id = e.target.value;
    this.state.currentPage = 1;
    this.loadExpensesList();
  }

  // Clear filters
  clearFilters() {
    document.getElementById('expense-search').value = '';
    document.getElementById('filter-group').value = '';
    document.getElementById('filter-friend').value = '';
    
    this.state.filters = { search: '', group_id: '', friend_id: '' };
    this.state.currentPage = 1;
    this.loadExpensesList();
  }

  // Change page
  changePage(direction) {
    this.state.currentPage += direction;
    this.loadExpensesList();
  }

  // Render Groups View
  renderGroups() {
    const grid = document.getElementById('groups-grid');
    if (!grid) return;

    if (this.state.groups.length === 0) {
      grid.innerHTML = '<p class="text-secondary">No groups joined yet.</p>';
      return;
    }

    grid.innerHTML = '';
    this.state.groups.forEach(g => {
      const avatar = g.avatar?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
      
      // Compile balance details
      let balanceHtml = '';
      g.original_debts.slice(0, 3).forEach(debt => {
        // Debt format
        balanceHtml += `
          <div class="bal-line">
            <span>${debt.from === this.state.currentUser.id ? 'You owe' : 'Owed to you'}</span>
            <span class="${debt.from === this.state.currentUser.id ? 'text-danger' : 'text-success'}">$${parseFloat(debt.amount).toFixed(2)}</span>
          </div>
        `;
      });

      if (balanceHtml === '') {
        balanceHtml = '<span class="text-muted">Settled Up</span>';
      }

      const card = `
        <div class="entity-card">
          <div class="entity-avatar-wrapper">
            <img class="entity-avatar" src="${avatar}" alt="">
          </div>
          <div class="entity-body">
            <span class="entity-title">${g.name}</span>
            <span class="entity-desc">${g.members?.length || 0} members • ${g.group_type || 'Group'}</span>
            <div class="entity-balance-summary">
              ${balanceHtml}
            </div>
          </div>
        </div>
      `;
      grid.insertAdjacentHTML('beforeend', card);
    });
  }

  // Render Friends View
  renderFriends() {
    const grid = document.getElementById('friends-grid');
    if (!grid) return;

    if (this.state.friends.length === 0) {
      grid.innerHTML = '<p class="text-secondary">No friends added yet.</p>';
      return;
    }

    grid.innerHTML = '';
    this.state.friends.forEach(f => {
      const avatar = f.picture?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
      
      let balanceText = 'Settled Up';
      let balanceClass = 'text-muted';
      
      if (f.balance && f.balance.length > 0) {
        const bal = parseFloat(f.balance[0].amount);
        if (bal > 0) {
          balanceText = `Owes you $${bal.toFixed(2)}`;
          balanceClass = 'text-success';
        } else if (bal < 0) {
          balanceText = `You owe $${Math.abs(bal).toFixed(2)}`;
          balanceClass = 'text-danger';
        }
      }

      const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || 'Unknown';

      const card = `
        <div class="entity-card">
          <div class="entity-avatar-wrapper">
            <img class="entity-avatar" src="${avatar}" alt="" style="border-radius: 50%;">
          </div>
          <div class="entity-body">
            <span class="entity-title">${name}</span>
            <span class="entity-desc">${f.email || ''}</span>
            <div class="entity-balance-summary">
              <div class="bal-line">
                <span>Balance:</span>
                <span class="${balanceClass}">${balanceText}</span>
              </div>
            </div>
          </div>
        </div>
      `;
      grid.insertAdjacentHTML('beforeend', card);
    });
  }

  // Modals management
  openApiKeyModal() {
    document.getElementById('api-key-modal').classList.remove('hidden');
  }

  closeApiKeyModal() {
    document.getElementById('api-key-modal').classList.add('hidden');
  }

  saveModalApiKey() {
    const key = document.getElementById('modal-api-key-input').value;
    if (!key) {
      this.showToast("Please enter a valid key.", "error");
      return;
    }
    API.setToken(key);
    this.closeApiKeyModal();
    this.showToast("API Key updated. Reconnecting...", "warning");
    setTimeout(() => window.location.reload(), 1000);
  }

  saveApiKey() {
    const key = document.getElementById('api-key-input').value;
    API.setToken(key);
    this.showToast("API Key updated successfully.", "success");
    setTimeout(() => window.location.reload(), 1000);
  }

  clearApiKey() {
    API.clearToken();
    this.showToast("API Key deleted. Please register another to continue.", "warning");
    setTimeout(() => window.location.reload(), 1000);
  }

  toggleApiKeyVisibility() {
    const input = document.getElementById('api-key-input');
    const icon = document.getElementById('key-visibility-icon');
    if (input.type === 'password') {
      input.type = 'text';
      icon.setAttribute('data-lucide', 'eye-off');
    } else {
      input.type = 'password';
      icon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
  }

  // Add / Edit Expense Modals Setup
  openExpenseModal() {
    document.getElementById('expense-modal-title').textContent = 'Add Expense';
    document.getElementById('expense-id').value = '';
    document.getElementById('expense-form').reset();
    
    // Default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('exp-date').value = today;

    // Reset splits state
    this.state.splitMode = 'equal';
    this.state.expenseParticipants = [];

    // Add current user as first participant
    this.addParticipant({
      user_id: this.state.currentUser.id,
      name: 'You',
      avatar: this.state.currentUser.picture?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y',
      paid_share: 0,
      owed_share: 0
    });

    const dropdown = document.getElementById('split-mode-select');
    if (dropdown) dropdown.value = 'equal';

    this.handleExpenseGroupChange();
    document.getElementById('expense-modal').classList.remove('hidden');
    lucide.createIcons();
  }

  closeExpenseModal() {
    document.getElementById('expense-modal').classList.add('hidden');
  }

  // Group dropdown changed in modal
  handleExpenseGroupChange() {
    const groupId = document.getElementById('exp-group').value;
    const friendSelector = document.getElementById('friend-selector-row');
    
    this.state.expenseParticipants = [];

    if (groupId) {
      // Group split: Hide friend picker, pull all members from group
      friendSelector.classList.add('hidden');
      const group = this.state.groups.find(g => g.id === parseInt(groupId));
      
      if (group && group.members) {
        group.members.forEach(member => {
          const isCurrentUser = member.id === this.state.currentUser.id;
          this.addParticipant({
            user_id: member.id,
            name: isCurrentUser ? 'You' : `${member.first_name || ''} ${member.last_name || ''}`.trim(),
            avatar: member.picture?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y',
            paid_share: 0,
            owed_share: 0
          });
        });
      }
    } else {
      // Individual split: Show friend picker, default user only
      friendSelector.classList.remove('hidden');
      
      this.addParticipant({
        user_id: this.state.currentUser.id,
        name: 'You',
        avatar: this.state.currentUser.picture?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y',
        paid_share: 0,
        owed_share: 0
      });
    }

    this.recalculateSplits();
  }

  // Add individual friend manually into individual split
  addIndividualFriendToExpense(e) {
    const friendId = parseInt(e.target.value);
    if (!friendId) return;

    // Check duplicate
    if (this.state.expenseParticipants.some(p => p.user_id === friendId)) {
      this.showToast("Friend is already included in split.", "warning");
      e.target.value = '';
      return;
    }

    const friend = this.state.friends.find(f => f.id === friendId);
    if (friend) {
      this.addParticipant({
        user_id: friend.id,
        name: `${friend.first_name || ''} ${friend.last_name || ''}`.trim(),
        avatar: friend.picture?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y',
        paid_share: 0,
        owed_share: 0
      });
      this.recalculateSplits();
    }

    e.target.value = '';
  }

  // Remove participant from individual split
  removeParticipant(userId) {
    if (userId === this.state.currentUser.id) {
      this.showToast("You must be included in the split.", "warning");
      return;
    }

    this.state.expenseParticipants = this.state.expenseParticipants.filter(p => p.user_id !== userId);
    this.recalculateSplits();
  }

  // Internal helper to push participants
  addParticipant(p) {
    this.state.expenseParticipants.push(p);
  }

  // Set splitting mode (equal vs exact vs percentage vs shares)
  setSplitMode(mode) {
    this.state.splitMode = mode;
    
    // Update dropdown value if it's not in sync
    const dropdown = document.getElementById('split-mode-select');
    if (dropdown && dropdown.value !== mode) {
      dropdown.value = mode;
    }

    // Update header label in table
    const headerLabel = document.getElementById('col-owed-header-label');
    if (headerLabel) {
      if (mode === 'equal' || mode === 'exact') {
        headerLabel.textContent = 'Owed Share ($)';
      } else if (mode === 'percentage') {
        headerLabel.textContent = 'Owed (%)';
      } else if (mode === 'shares') {
        headerLabel.textContent = 'Shares';
      }
    }

    // Reset temporary variables for percentages/shares if switching to those modes
    const count = this.state.expenseParticipants.length;
    if (count > 0) {
      this.state.expenseParticipants.forEach(p => {
        if (mode === 'percentage' && (p.percentage === undefined || p.percentage === null)) {
          p.percentage = 100 / count;
        }
        if (mode === 'shares' && (p.share === undefined || p.share === null)) {
          p.share = 1;
        }
      });
    }

    this.recalculateSplits(true); // force full re-render
  }

  // Recalculates split values (paid/owed shares)
  recalculateSplits(shouldRender = true) {
    const costInput = document.getElementById('exp-cost');
    const totalCost = parseFloat(costInput.value) || 0;
    
    const count = this.state.expenseParticipants.length;
    if (count === 0) return;

    if (this.state.splitMode === 'equal') {
      // Calculate equal split shares
      const rawShare = totalCost / count;
      const roundedShare = Math.round(rawShare * 100) / 100;
      
      let accumulated = 0;
      this.state.expenseParticipants.forEach((p, idx) => {
        if (idx === count - 1) {
          p.owed_share = Math.max(0, totalCost - accumulated);
        } else {
          p.owed_share = roundedShare;
          accumulated += roundedShare;
        }
      });
    } else if (this.state.splitMode === 'percentage') {
      // Calculate percentage split shares
      let totalPercent = 0;
      this.state.expenseParticipants.forEach(p => {
        if (p.percentage === undefined || p.percentage === null) {
          p.percentage = 100 / count;
        }
        totalPercent += p.percentage;
      });

      let accumulated = 0;
      this.state.expenseParticipants.forEach((p, idx) => {
        if (idx === count - 1) {
          p.owed_share = Math.max(0, totalCost - accumulated);
        } else {
          const rawShare = (p.percentage / 100) * totalCost;
          const roundedShare = Math.round(rawShare * 100) / 100;
          p.owed_share = roundedShare;
          accumulated += roundedShare;
        }
      });
    } else if (this.state.splitMode === 'shares') {
      // Calculate shares split shares
      let totalShares = 0;
      this.state.expenseParticipants.forEach(p => {
        if (p.share === undefined || p.share === null) {
          p.share = 1;
        }
        totalShares += p.share;
      });

      if (totalShares > 0) {
        let accumulated = 0;
        this.state.expenseParticipants.forEach((p, idx) => {
          if (idx === count - 1) {
            p.owed_share = Math.max(0, totalCost - accumulated);
          } else {
            const rawShare = (p.share / totalShares) * totalCost;
            const roundedShare = Math.round(rawShare * 100) / 100;
            p.owed_share = roundedShare;
            accumulated += roundedShare;
          }
        });
      } else {
        this.state.expenseParticipants.forEach(p => p.owed_share = 0);
      }
    }

    // Default: if all paid shares are 0, make current user the default payer
    const hasPayer = this.state.expenseParticipants.some(p => p.paid_share > 0);
    if (!hasPayer) {
      this.state.expenseParticipants.forEach(p => {
        if (p.user_id === this.state.currentUser.id) {
          p.paid_share = totalCost;
        } else {
          p.paid_share = 0;
        }
      });
    }

    if (shouldRender) {
      this.renderParticipantsList();
    }
    this.validateSplits();
  }

  // Sync inputs from UI to local array
  syncSharesFromUI() {
    this.state.expenseParticipants.forEach(p => {
      const paidInput = document.getElementById(`paid-input-${p.user_id}`);
      const owedInput = document.getElementById(`owed-input-${p.user_id}`);

      if (paidInput) p.paid_share = parseFloat(paidInput.value) || 0;
      
      if (owedInput) {
        const val = parseFloat(owedInput.value) || 0;
        if (this.state.splitMode === 'exact') {
          p.owed_share = val;
        } else if (this.state.splitMode === 'percentage') {
          p.percentage = val;
        } else if (this.state.splitMode === 'shares') {
          p.share = val;
        }
      }
    });

    // Run recalculateSplits so that percentage or shares changes propagate immediately to owed_shares!
    if (this.state.splitMode === 'percentage' || this.state.splitMode === 'shares') {
      this.recalculateSplits(false); // pass false so we don't re-render and lose focus
    } else {
      this.validateSplits();
    }
  }

  // Validate that sum of paid shares equals cost, and sum of owed shares equals cost (or percentages = 100%)
  validateSplits() {
    const costInput = document.getElementById('exp-cost');
    const totalCost = parseFloat(costInput.value) || 0;

    let sumPaid = 0;
    let sumOwed = 0;
    let sumPercent = 0;

    this.state.expenseParticipants.forEach(p => {
      sumPaid += p.paid_share;
      sumOwed += p.owed_share;
      if (this.state.splitMode === 'percentage') {
        sumPercent += p.percentage || 0;
      }
    });

    // Format for comparison
    sumPaid = Math.round(sumPaid * 100) / 100;
    sumOwed = Math.round(sumOwed * 100) / 100;
    sumPercent = Math.round(sumPercent * 100) / 100;

    const paidSumEl = document.getElementById('val-paid-sum');
    const paidTargetEl = document.getElementById('val-paid-target');
    const owedSumEl = document.getElementById('val-owed-sum');
    const owedTargetEl = document.getElementById('val-owed-target');
    const paidDot = document.querySelector('#val-paid .val-dot');
    const owedDot = document.querySelector('#val-owed .val-dot');

    if (paidSumEl) paidSumEl.textContent = `$${sumPaid.toFixed(2)}`;
    if (paidTargetEl) paidTargetEl.textContent = `$${totalCost.toFixed(2)}`;

    let isOwedValid = false;

    if (this.state.splitMode === 'percentage') {
      if (owedSumEl) owedSumEl.textContent = `${sumPercent.toFixed(1)}%`;
      if (owedTargetEl) owedTargetEl.textContent = `100.0%`;
      isOwedValid = (Math.abs(sumPercent - 100) < 0.05);
    } else if (this.state.splitMode === 'shares') {
      let totalShares = 0;
      this.state.expenseParticipants.forEach(p => totalShares += p.share || 0);
      isOwedValid = totalShares > 0;
      if (owedSumEl) owedSumEl.textContent = `${totalShares} shares`;
      if (owedTargetEl) owedTargetEl.textContent = `> 0 shares`;
    } else {
      if (owedSumEl) owedSumEl.textContent = `$${sumOwed.toFixed(2)}`;
      if (owedTargetEl) owedTargetEl.textContent = `$${totalCost.toFixed(2)}`;
      isOwedValid = (Math.abs(sumOwed - totalCost) < 0.01);
    }

    const isPaidValid = (Math.abs(sumPaid - totalCost) < 0.01);

    if (paidDot) paidDot.className = `val-dot ${isPaidValid ? 'dot-success' : 'dot-error'}`;
    if (owedDot) owedDot.className = `val-dot ${isOwedValid ? 'dot-success' : 'dot-error'}`;

    return isPaidValid && isOwedValid;
  }

  // Render participants rows dynamically inside modal
  renderParticipantsList() {
    const container = document.getElementById('participants-container');
    if (!container) return;

    container.innerHTML = '';
    const isGroup = !!document.getElementById('exp-group').value;

    this.state.expenseParticipants.forEach(p => {
      // Remove button only for individual splits (groups have fixed participants)
      const removeBtn = (!isGroup && p.user_id !== this.state.currentUser.id) 
        ? `<button type="button" class="btn-remove-part" onclick="app.removeParticipant(${p.user_id})"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>`
        : '';

      let valField = '';
      if (this.state.splitMode === 'equal') {
        valField = `<input type="number" class="participant-input" id="owed-input-${p.user_id}" value="${p.owed_share ? p.owed_share.toFixed(2) : '0.00'}" disabled>`;
      } else if (this.state.splitMode === 'exact') {
        valField = `<input type="number" class="participant-input" id="owed-input-${p.user_id}" value="${p.owed_share ? p.owed_share.toFixed(2) : '0.00'}" step="0.01" min="0" oninput="app.syncSharesFromUI()">`;
      } else if (this.state.splitMode === 'percentage') {
        const percentVal = p.percentage !== undefined ? p.percentage : (100 / this.state.expenseParticipants.length);
        valField = `<input type="number" class="participant-input" id="owed-input-${p.user_id}" value="${percentVal.toFixed(1)}" step="0.1" min="0" max="100" oninput="app.syncSharesFromUI()">`;
      } else if (this.state.splitMode === 'shares') {
        const shareVal = p.share !== undefined ? p.share : 1;
        valField = `<input type="number" class="participant-input" id="owed-input-${p.user_id}" value="${shareVal}" step="1" min="0" oninput="app.syncSharesFromUI()">`;
      }

      const rowHtml = `
        <div class="participant-row">
          <div class="participant-cell-name">
            <img class="part-avatar" src="${p.avatar}" alt="">
            <span>${p.name}</span>
          </div>
          <div class="participant-cell-paid">
            <input type="number" class="participant-input" id="paid-input-${p.user_id}" value="${p.paid_share ? p.paid_share.toFixed(2) : '0.00'}" step="0.01" min="0" oninput="app.syncSharesFromUI()">
          </div>
          <div class="participant-cell-owed">
            ${valField}
            ${removeBtn}
          </div>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', rowHtml);
    });

    lucide.createIcons();
  }

  // Handle Create / Edit form submit
  async handleExpenseSubmit(e) {
    e.preventDefault();
    this.syncSharesFromUI();

    if (!this.validateSplits()) {
      this.showToast("Total shares mismatch cost. Please adjust paid/owed allocations.", "error");
      return;
    }

    const description = document.getElementById('exp-description').value;
    const cost = parseFloat(document.getElementById('exp-cost').value);
    const date = document.getElementById('exp-date').value;
    const category_id = document.getElementById('exp-category').value;
    const group_id = document.getElementById('exp-group').value;
    const expenseId = document.getElementById('expense-id').value;

    // Build payload structure
    const payload = {
      description,
      cost: cost.toFixed(2),
      date,
      category_id: parseInt(category_id)
    };

    if (group_id) payload.group_id = parseInt(group_id);

    // Flatten user shares into keys: users__0__user_id, paid_share, owed_share
    this.state.expenseParticipants.forEach((p, idx) => {
      payload[`users__${idx}__user_id`] = p.user_id;
      payload[`users__${idx}__paid_share`] = p.paid_share.toFixed(2);
      payload[`users__${idx}__owed_share`] = p.owed_share.toFixed(2);
    });

    const submitBtn = document.getElementById('btn-submit-expense');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      if (expenseId) {
        // Edit
        await API.updateExpense(expenseId, payload);
        this.showToast("Expense updated successfully.", "success");
      } else {
        // Create
        await API.createExpense(payload);
        this.showToast("Expense added successfully.", "success");
      }
      this.closeExpenseModal();
      await this.loadAllBaseData(); // Refresh totals & balances
      this.switchTab('expenses'); // Switch back to view list
    } catch (err) {
      console.error("Save expense failed:", err);
      this.showToast(`Error saving transaction: ${err.message}`, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Expense';
    }
  }

  // Edit Expense Setup
  openEditExpenseModal(id) {
    const exp = this.state.expenses.find(e => e.id === id);
    if (!exp) return;

    document.getElementById('expense-modal-title').textContent = 'Edit Expense';
    document.getElementById('expense-id').value = exp.id;
    document.getElementById('exp-description').value = exp.description;
    document.getElementById('exp-cost').value = parseFloat(exp.cost);
    document.getElementById('exp-date').value = exp.date.split('T')[0];
    document.getElementById('exp-category').value = exp.category?.id || '';
    document.getElementById('exp-group').value = exp.group_id || '';

    // Fetch splits setup
    this.state.expenseParticipants = [];
    
    // Determine splitMode (if equal or exact)
    // In equal split, owed shares are identical. We can guess by checking if all owed shares match
    const owedShares = exp.users.map(u => parseFloat(u.owed_share));
    const allEqual = owedShares.every(val => Math.abs(val - owedShares[0]) < 0.05);
    this.state.splitMode = allEqual ? 'equal' : 'exact';

    const dropdown = document.getElementById('split-mode-select');
    if (dropdown) dropdown.value = this.state.splitMode;
    const headerLabel = document.getElementById('col-owed-header-label');
    if (headerLabel) headerLabel.textContent = 'Owed Share ($)';

    // Load participants from expense data
    exp.users.forEach(u => {
      const isCurrentUser = u.user_id === this.state.currentUser.id;
      this.addParticipant({
        user_id: u.user_id,
        name: isCurrentUser ? 'You' : `${u.user?.first_name || ''} ${u.user?.last_name || ''}`.trim() || 'Unknown',
        avatar: u.user?.picture?.medium || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y',
        paid_share: parseFloat(u.paid_share) || 0,
        owed_share: parseFloat(u.owed_share) || 0
      });
    });

    const isGroup = !!exp.group_id;
    const friendSelector = document.getElementById('friend-selector-row');
    if (isGroup) {
      friendSelector.classList.add('hidden');
    } else {
      friendSelector.classList.remove('hidden');
    }

    this.renderParticipantsList();
    this.validateSplits();
    document.getElementById('expense-modal').classList.remove('hidden');
  }

  // Delete Expense
  async deleteExpenseItem(id) {
    if (!confirm("Are you sure you want to delete this transaction from Splitwise?")) return;

    // Optimistic UI update: hide immediately
    const el = document.getElementById(`exp-wrapper-${id}`);
    if (el) {
      el.style.opacity = '0.5';
      el.style.pointerEvents = 'none';
    }

    try {
      await API.deleteExpense(id);
      this.showToast("Transaction deleted successfully.", "success");
      // Reload lists
      await this.loadAllBaseData();
      this.loadExpensesList();
    } catch (err) {
      console.error("Delete failed:", err);
      this.showToast(`Failed to delete transaction: ${err.message}`, "error");
      // Reset opacity
      if (el) {
        el.style.opacity = '1';
        el.style.pointerEvents = 'all';
      }
    }
  }

  // Settle Up Modal Setup
  openSettleUpModal() {
    document.getElementById('settle-form').reset();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('settle-date').value = today;
    
    document.getElementById('settle-modal').classList.remove('hidden');
  }

  closeSettleUpModal() {
    document.getElementById('settle-modal').classList.add('hidden');
  }

  // Update Direction label based on selected friend
  handleSettleFriendChange() {
    const friendId = document.getElementById('settle-friend').value;
    const label = document.getElementById('settle-dir-friend-text');
    if (friendId) {
      const friend = this.state.friends.find(f => f.id === parseInt(friendId));
      const name = friend ? friend.first_name : 'Friend';
      label.textContent = `${name} paid you`;
    } else {
      label.textContent = 'Friend paid';
    }
  }

  // Submit Settlement Payment
  async handleSettleSubmit(e) {
    e.preventDefault();

    const friendId = parseInt(document.getElementById('settle-friend').value);
    const amount = parseFloat(document.getElementById('settle-amount').value);
    const date = document.getElementById('settle-date').value;
    const direction = document.querySelector('input[name="settle-direction"]:checked').value;

    if (!friendId) {
      this.showToast("Please choose a friend.", "error");
      return;
    }

    const payload = {
      description: "Settle Up",
      cost: amount.toFixed(2),
      date,
      payment: true // Custom split flag designating payment
    };

    // Settlement shares:
    // If "you-paid":
    //   You: paid = amount, owed = 0
    //   Friend: paid = 0, owed = amount
    // If "friend-paid":
    //   You: paid = 0, owed = amount
    //   Friend: paid = amount, owed = 0
    if (direction === 'you-paid') {
      payload['users__0__user_id'] = this.state.currentUser.id;
      payload['users__0__paid_share'] = amount.toFixed(2);
      payload['users__0__owed_share'] = '0.00';
      payload['users__1__user_id'] = friendId;
      payload['users__1__paid_share'] = '0.00';
      payload['users__1__owed_share'] = amount.toFixed(2);
    } else {
      payload['users__0__user_id'] = this.state.currentUser.id;
      payload['users__0__paid_share'] = '0.00';
      payload['users__0__owed_share'] = amount.toFixed(2);
      payload['users__1__user_id'] = friendId;
      payload['users__1__paid_share'] = amount.toFixed(2);
      payload['users__1__owed_share'] = '0.00';
    }

    try {
      await API.createExpense(payload);
      this.showToast("Payment recorded successfully.", "success");
      this.closeSettleUpModal();
      await this.loadAllBaseData(); // reload balances
      this.switchTab('dashboard'); // refresh stats
    } catch (err) {
      console.error("Recording payment failed:", err);
      this.showToast(`Error recording settlement: ${err.message}`, "error");
    }
  }

  // Toast message helpers
  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    let icon = 'info';
    if (type === 'success') icon = 'circle-check';
    if (type === 'error') icon = 'circle-alert';
    if (type === 'warning') icon = 'alert-triangle';

    const toastHtml = `
      <div class="toast ${type}">
        <div class="toast-icon">
          <i data-lucide="${icon}" style="width: 18px; height: 18px;"></i>
        </div>
        <div class="toast-message">${message}</div>
        <button class="toast-close" onclick="this.parentElement.remove()">
          <i data-lucide="x" style="width: 14px; height: 14px;"></i>
        </button>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', toastHtml);
    lucide.createIcons();

    // Auto-remove after 4.5 seconds
    const element = container.lastElementChild;
    setTimeout(() => {
      if (element) {
        element.style.opacity = '0';
        element.style.transform = 'translateX(100%)';
        setTimeout(() => element.remove(), 300);
      }
    }, 4500);
  }
}

// Instantiate and start app
const app = new SplitwiseApp();
window.onload = () => {
  app.init();
};
