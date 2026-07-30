# 🏠 splitwise-roommate

[![npm version](https://img.shields.io/badge/npm-1.0.0-blue.svg)](https://github.com/karbaz017/splitwise-roommate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-green.svg)](https://nodejs.org)

> A modern Node.js + Express + vanilla JS web application for managing shared roommate expenses, fully integrated with the Splitwise API.

---

## ✨ Features

- **📊 Visual Spending Dashboard**: Categorized charts rendering category distributions using **Chart.js**.
- **💳 Settle Up Balances**: Record payment transactions directly from the UI using Splitwise's cash transfer API (`payment: true`).
- **🎛️ Multi-Type Splitting**: Select between equal splits, exact amounts, percentages (%), or weighted shares (2:1:1).
- **💸 Live Smart Validation**: real-time calculation validation checking that paid and owed shares match the total cost.
- **⚡ Local Speed & Cache**: Instant boot using local metadata caching (`localStorage`) before performing background API refreshes.
- **✨ Glassmorphic Layout**: Vibrant, modern dark-mode interface utilizing smooth animations and **Lucide Icons**.

---

## 🚀 Quick Start Guide

### 📋 Prerequisites
- **Node.js** (v16.0.0 or higher; tested on v25)
- **NPM** (v8.0.0 or higher)
- A **Splitwise Account** (to register an app and obtain a Personal API Key)

### 📥 Installation Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/karbaz017/splitwise-roommate.git
   cd splitwise-roommate
   ```

2. **Install package dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Copy the sample environment configuration file:
   ```bash
   cp .env.example .env
   ```
   Open the `.env` file and add your configuration details. (See the [Setup Guide](docs/SETUP.md) for how to obtain a Splitwise Personal API Key).
   ```env
   PORT=3000
   SPLITWISE_API_KEY=your_personal_api_key_here
   ```

---

## 🛠️ Usage

### Running the server in development mode:
```bash
npm run dev
```

### Running the server in production mode:
```bash
npm start
```

Once started, open your browser and navigate to:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📚 Documentation

Detailed documentation is available in the `docs/` folder:
- 🗺️ **[System Architecture](docs/ARCHITECTURE.md)**: Design, proxy layer, data flows, and security guidelines.
- ⚙️ **[Installation & Setup](docs/SETUP.md)**: Comprehensive quick-start and API token guide.
- 🔌 **[Backend API Reference](docs/API.md)**: REST endpoints table and response schema guidelines.
- 📋 **[Features & Specifications](docs/FEATURES.md)**: Product specifications and milestones.
- ❓ **[FAQ & Troubleshooting](docs/FAQ.md)**: Answers to common integration questions.

---

## 🗺️ Roadmap

- **v1.0.0** (Current Release) ✅
  - Group and Friend list rendering.
  - Expense creation and deletion.
  - Multiple split types (equal, custom, percentage, shares).
  - "Settle Up" transaction logic.
- **v1.1.0** (Planned) 📅
  - Recurring roommate subscription tracking.
  - Receipt image scanning & OCR parsing.
  - Audit trail and group logs.
- **v2.0.0** (Future) 🚀
  - local Database caching backend (MongoDB / PostgreSQL).
  - Multi-user authentication profiles.
  - Dockerized container configurations.

---

## 🤝 Contributing

Contributions are welcome! Please read the **[Contributing Guidelines](CONTRIBUTING.md)** and our **[Code of Conduct](CODE_OF_CONDUCT.md)** before opening pull requests.

---

## 🔒 Security Note: API Keys
This app uses a personal proxy server to communicate with Splitwise to avoid browser CORS blocks. **Never commit your `.env` file** or hardcode API keys. The keys are either kept in the server-side `.env` or stored locally inside your browser's private `localStorage`.

---

## 📄 License
This project is licensed under the MIT License - see the **[LICENSE](LICENSE)** file for details.
