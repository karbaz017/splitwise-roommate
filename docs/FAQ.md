# FAQ & Troubleshooting

This document addresses frequently asked questions and troubleshooting guides for the **splitwise-roommate** application.

---

## ❓ Frequently Asked Questions

### Q: How do I get my Splitwise API key?
**A**: You can generate a Personal API Key directly from your Splitwise developer profile:
1. Log in to the **[Splitwise Apps Registry](https://secure.splitwise.com/apps)**.
2. Click **"Register your application"** and fill out the details (using placeholder URLs like `http://localhost:3000`).
3. Click **"Register"**, then click **"Create a personal API key"** inside your app's info page.
4. Copy the long token string.

### Q: Is my API key secure?
**A**: **Yes**. Your API key is stored either locally in your server-side `.env` file (which is excluded from Git commit histories via `.gitignore`) or securely inside your own web browser's private `localStorage`. It is only sent to your local Express reverse proxy to append headers, and never shared with third-party databases.

### Q: Can I use this with multiple Splitwise accounts?
**A**: Currently, the backend server uses a single default key from the `.env` file. However, if you leave the `.env` key empty, the web interface prompts the user to enter their key upon opening the dashboard. This allows different users to access their own accounts on the same dashboard interface (storing their respective tokens in their browser's `localStorage`).

### Q: What if the Splitwise API changes?
**A**: We use the standard Splitwise REST API v3.0, which has been stable for a long time. If endpoints change, updates will be rolled out to the Express reverse proxy server (`server.js`) to map request coordinates accordingly, without requiring changes to the core client SPA files.

### Q: Can multiple roommates use this dashboard at once?
**A**: Yes. By utilizing the browser `localStorage` option, each roommate can load the web page from their own device, enter their own API key, and view their respective groups, friends, and bills.

---

## 🔍 Troubleshooting Guide

### ❌ Server fails to start with `EADDRINUSE: address already in use :::3000`
- **Cause**: Another program is already using port 3000 on your machine (e.g. another Node.js app, or a React dev server).
- **Fix**: Open your local `.env` file and change the port number:
  ```env
  PORT=4000
  ```
  Restart the server and open `http://localhost:4000`.

### ❌ The dashboard loads but shows "Setup API Key" prompt
- **Cause**: The API key is missing from `.env` or expired.
- **Fix**: Enter your API key directly in the web UI modal. If it persists, log back into the Splitwise portal and check if the token is valid or needs to be re-created.

### ❌ Toast Notification: "Total shares mismatch cost"
- **Cause**: You are trying to submit a custom percentage or amount split where the sum of participants' shares does not equal the total cost.
- **Fix**: Look at the status bar at the bottom of the split form. Adjust the inputs until the paid and owed validation indicators show green and match the cost.
