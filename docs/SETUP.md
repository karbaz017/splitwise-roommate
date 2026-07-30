# Installation & Setup Guide

Follow this guide to get **splitwise-roommate** up and running on your local machine.

---

## 📋 Prerequisites

Before starting, make sure you have the following installed:
- **Node.js** (v16.0.0 or higher; v18+ recommended)
- **NPM** (v8.0.0 or higher)
- A **Splitwise Account**

---

## 📥 Step-by-Step Installation

### Step 1: Clone the Repository
Clone the project to your local directory:
```bash
git clone https://github.com/karbaz017/splitwise-roommate.git
cd splitwise-roommate
```

### Step 2: Install Package Dependencies
Install the required packages (Express, Dotenv):
```bash
npm install
```

### Step 3: Register your Splitwise App
To communicate with Splitwise, you must register a developer application to generate a Personal API Key:
1. Navigate to the **[Splitwise Application Registry](https://secure.splitwise.com/apps)** and log in.
2. Click **"Register your application"**.
3. Fill out the application details:
   - *Application Name*: `Roommate Dashboard` (or any name you prefer)
   - *Main Application URL*: `http://localhost:3000`
   - *Redirect URL*: `http://localhost:3000` (since we use personal keys, callbacks are not needed, but a URL must be input)
4. Check the box to agree to the terms, and click **"Register"**.
5. Once registered, click **"Create a personal API key"** inside your application page.
6. Copy the long token string provided.

### Step 4: Configure Environment Variables
1. Create your local environment configuration file:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` in your code editor and paste your key:
   ```env
   PORT=3000
   SPLITWISE_API_KEY=your_copied_api_key_here
   NODE_ENV=development
   ```

### Step 5: Start the Server
Run the startup script:
```bash
npm start
```
*Note: For auto-reloading on changes, you can use `npm run dev`.*

### Step 6: Open the Dashboard
Navigate to the dashboard in your web browser:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🔍 Troubleshooting & Common Errors

### 1. `EADDRINUSE` Error (Port already in use)
If you see the error `listen EADDRINUSE: address already in use :::3000`:
- **Cause**: Another service is running on port 3000.
- **Fix**: Either close the program occupying the port, or change the `PORT` number inside your `.env` file (e.g., `PORT=4000`), then restart the server.

### 2. `401 Unauthorized` Alert
If the app boots but opens a "Setup API Key" prompt:
- **Cause**: The API key is missing or has expired.
- **Fix**: Re-check your `.env` file or paste a newly generated Personal API Key directly in the frontend modal.

### 3. CSS/Styling is not loading
If you see text but no formatting:
- **Cause**: Static file mapping is missing or directory pathing is incorrect.
- **Fix**: Ensure your folders are structured exactly as indicated in the README structure: the stylesheet must reside in `public/css/style.css`.
