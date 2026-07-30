# System Architecture Specification

This document details the system design, API endpoints, data flow, state management, and security decisions for the **splitwise-roommate** application.

---

## 🗺️ System Topology

Because the Splitwise API restricts direct browser-to-server HTTP requests due to CORS restrictions, we implement a reverse proxy layout. The Node.js server sits between the client Single Page Application and Splitwise, injecting authentication headers on requests.

```text
┌─────────────────────────────────┐
│           Client SPA            │
│  (Vanilla HTML/CSS/JS Browser)  │
└────────────────┬────────────────┘
                 │
                 │ HTTP Local Requests (with X-Splitwise-Token header)
                 ▼
┌─────────────────────────────────┐
│     Express Reverse Proxy       │
│      (Local Node.js Server)     │
└────────────────┬────────────────┘
                 │
                 │ HTTPS Proxy Requests (with Bearer Authorization header)
                 ▼
┌─────────────────────────────────┐
│          Splitwise API          │
│   (https://secure.splitwise.com)│
└─────────────────────────────────┘
```

---

## 🔌 Backend Proxy Endpoints

The Express server (`server.js`) maps incoming local HTTP routes to Splitwise API v3.0 endpoints.

| HTTP Method | Local Proxy Route | Target Splitwise Endpoint | Purpose |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/user` | `/get_current_user` | Fetch authenticated profile details (name, email, avatar). |
| **GET** | `/api/groups` | `/get_groups` | Retrieve groups list joined by the user. |
| **GET** | `/api/friends` | `/get_friends` | Retrieve friends list and net balances. |
| **GET** | `/api/categories` | `/get_categories` | Retrieve standard Splitwise expense categories. |
| **GET** | `/api/expenses` | `/get_expenses` | Paginate transactions (supports filter query parameters). |
| **GET** | `/api/expenses/:id` | `/get_expense/:id` | Retrieve detailed breakdown of a single transaction. |
| **POST** | `/api/expenses` | `/create_expense` | Create a new expense or record cash payment. |
| **POST** | `/api/expenses/:id` | `/update_expense/:id` | Update an existing transaction. |
| **POST** | `/api/expenses/:id/delete` | `/delete_expense/:id` | Delete a transaction. |

---

## 🎛️ Frontend State Management

The frontend uses a single monolithic state object inside the `SplitwiseApp` controller in `public/js/app.js` to manage UI conditions, cached lists, and page states:

```javascript
this.state = {
  currentUser: null,           // Logged-in profile object
  groups: [],                  // Cached list of groups
  friends: [],                 // Cached list of friends with balances
  categories: [],              // Cached categories tree
  expenses: [],                // Paginated transactions for active view
  currentPage: 1,              // Active page index
  totalPages: 1,               // Total pages count
  limit: 15,                   // Items per page limit
  splitMode: 'equal',          // Active form split type (equal/exact/percentage/shares)
  expenseParticipants: [],     // Users included in active transaction split
  activeTab: 'dashboard',      // Active sidebar tab
  categoryChart: null          // Chart.js instance for category analytics
};
```

---

## 🔄 Transaction Data Flow

When a roommate logs a custom split expense, the data flows as follows:

1. **User Action**: The user fills out the description, cost, dates, select split mode (e.g. *Split by Percentages*), inputs participant shares, and clicks **"Save Expense"**.
2. **Form Validation**: The client calculates shares, verifying that the sum matches the cost or 100%. If mismatched, it blocks submission.
3. **Payload Generation**: The client flattens shares into indexed parameters (e.g., `users__0__user_id`, `users__0__paid_share`, etc.) and posts them to `/api/expenses`.
4. **Proxy Injection**: The Express server intercepts the post request, extracts the API token from headers, wraps it as a `Bearer` token inside the `Authorization` header, and forwards the JSON payload to Splitwise.
5. **Splitwise Processing**: Splitwise registers the transaction, updates room accounts, and returns a transaction schema response.
6. **UI Refresh**: The server returns the JSON response, the frontend clears the modal, refetches balances in the background, updates local caching, and transitions the tab view.

---

## 💡 Key Design Decisions

- **Reverse Proxy Layer**: Bypasses browser-level CORS blocking and protects API keys from being exposed in public network traffic if hosted.
- **Vanilla JS Core**: Keeps bundle sizes near zero, loads instantly, and runs with zero compilation step.
- **Client Cache**: Pulls metadata (`groups`, `friends`, `categories`) from `localStorage` immediately upon browser boot, making the app feel instantaneous while a fresh fetch completes.
- **Rounding Correction**: Equal splits division (e.g. `$10.00 / 3`) generates infinite decimals. The app computes and places rounding differences on the first user to enforce exact sum verification before calling Splitwise.

---

## 🔒 Security Considerations

1. **Token Protection**: API keys are never written to repository source control. They reside either in local server `.env` files or inside browser `localStorage`.
2. **Proxy Header Delivery**: When storing keys in the browser, the token is sent to the local server via the custom request header `X-Splitwise-Token`, keeping it out of query parameters which could be logged by proxies.
3. **Inputs Sanitation**: The browser validates types and enforces min/max limits (like percentage ranges or positive numbers) to avoid API injection vulnerabilities.
