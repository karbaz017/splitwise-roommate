# Changelog

All notable changes to the **splitwise-roommate** project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-30 (Current Release)

### Added
- 🚀 **Core Application Setup**: Express-based proxy API server and static client files.
- 📊 **Visual Spending Dashboard**: Integrated **Chart.js** displaying visual spending breakdown charts.
- 🎛️ **Multi-Type Splitting**: Selection options in the expense form supporting Equal splits, Exact dollar amounts, Percentages (%), and Shares splits.
- 💸 **Smart Allocation Validation**: Real-time status indicators in form footer verifying paid/owed allocations match expense cost.
- 💵 **Settle Up Recording**: Dynamic payment entry modal representing cash settlements (`payment: true` in Splitwise API).
- 🧩 **Details view**: Click on transaction cards to dynamically reveal detailed splits, avatars, and metadata.
- 💾 **Local Cache**: Local storage (`localStorage`) metadata caching for lightning fast page loads.

---

## [1.1.0] - Planned

### Added
- 📅 **Recurring Bills Tracker**: Automate month-to-month rent or subscription alerts.
- 📸 **Receipt Scanning & OCR**: Attach images to expenses and read items automatically.
- 📈 **Net Balance Trends**: Line charts monitoring balance changes over historical months.
- 📑 **Audit Trail Logs**: Activity logs indicating who added, updated, or deleted bills.

---

## [2.0.0] - Future

### Added
- 🗄️ **Persistent Database Integration**: Connect PostgreSQL or MongoDB to store details locally.
- 👥 **Multi-Roommate Profile Logins**: Support separate login sessions.
- 🐋 **Docker Containerization**: Multi-architecture Docker configurations for quick local deployment.
