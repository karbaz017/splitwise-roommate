# Features & Roadmap Specification

This document details the functional specifications, product roadmap, and upcoming enhancements for the **splitwise-roommate** application.

---

## 🗺️ Product Roadmap

### 📦 v1.0.0 (Current Release) - Core Manager ✅
- **✅ Group & Friend Synchronization**: Fetches and lists all active Splitwise groups and friends automatically.
- **✅ Transaction Registry**: Full read/create/update/delete (CRUD) functions for expenses.
- **✅ Multi-Type Split Controller**: Supports splitting equally, exact amounts, percentages (%), or shares weights.
- **✅ visual dashboard**: Category-wise expense breakdown doughnut chart using **Chart.js**.
- **✅ Settle Up Modal**: Instantly records cash payments (`payment: true`) to resolve roommate debts.
- **✅ live share validation**: Status bar verifying that paid and owed shares tally matches the bill cost.

---

### 📅 v1.1.0 (Planned Release) - Roommate Utilities

#### 1. Recurring Bills Tracker
- **Description**: Add support for automated monthly billing configurations (e.g. utilities, Wi-Fi subscriptions, rent). It will automatically notify room members when payments are due.

#### 2. Receipt Scan & OCR
- **Description**: Roommates can snap photos of grocery receipts directly in the browser. The app will extract line-items, tax, and totals, allowing users to select who gets billed for which item.

#### 3. Group Activity Logs
- **Description**: An audit log displaying who created, modified, or settled transactions in the shared space to prevent confusion.

---

### 🚀 v2.0.0 (Future Release) - Roommate Portal

#### 1. local Database caching (PostgreSQL / SQLite)
- **Description**: Persist transactions locally to enable faster historical searches, offline draft creation, and advanced roommate analytics.

#### 2. Multi-User Authentication Profiles
- **Description**: Allow different roommates to log into the dashboard securely with their own credentials while sharing a central roommate environment.

#### 3. Dockerized Deployments
- **Description**: Create pre-configured Docker images enabling roommates to self-host the portal on home servers or Raspberry Pi hubs easily.

---

## 🤝 Want to help?

We are always looking for contributors to help build new roommate features!
- If you'd like to work on a feature listed in the roadmap, check out our **[Contributing Guidelines](../CONTRIBUTING.md)**.
- For design ideas or feature suggestions, feel free to open a feature request in our **[GitHub Issues page](https://github.com/karbaz017/splitwise-roommate/issues)**.
