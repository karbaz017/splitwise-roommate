import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve static folder path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Proxy helper function to make API requests to Splitwise
async function proxyRequest(url, method, req, res) {
  const token = req.headers['x-splitwise-token'] || process.env.SPLITWISE_API_KEY;
  if (!token) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Splitwise API Key is missing. Please provide it via the X-Splitwise-Token header or configure SPLITWISE_API_KEY in the server's .env file."
    });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };

  const options = {
    method,
    headers,
  };

  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(req.body);
  }

  try {
    const response = await fetch(url, options);
    
    // Splitwise API might return error codes (like 400 or 403) with JSON bodies.
    // Let's parse the JSON and return it with the correct status code.
    const textContent = await response.text();
    let data;
    try {
      data = JSON.parse(textContent);
    } catch {
      data = { rawResponse: textContent };
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.error(`Error proxying ${method} to ${url}:`, error);
    return res.status(500).json({ error: "proxy_error", message: error.message });
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Proxy routes for Splitwise API v3.0

// Get Current User
app.get('/api/user', async (req, res) => {
  await proxyRequest('https://secure.splitwise.com/api/v3.0/get_current_user', 'GET', req, res);
});

// Get Groups
app.get('/api/groups', async (req, res) => {
  await proxyRequest('https://secure.splitwise.com/api/v3.0/get_groups', 'GET', req, res);
});

// Get Friends
app.get('/api/friends', async (req, res) => {
  await proxyRequest('https://secure.splitwise.com/api/v3.0/get_friends', 'GET', req, res);
});

// Get Categories
app.get('/api/categories', async (req, res) => {
  await proxyRequest('https://secure.splitwise.com/api/v3.0/get_categories', 'GET', req, res);
});

// Get Expenses (supports filtering via query params like group_id, limit, offset, etc.)
app.get('/api/expenses', async (req, res) => {
  const url = new URL('https://secure.splitwise.com/api/v3.0/get_expenses');
  Object.keys(req.query).forEach(key => url.searchParams.append(key, req.query[key]));
  await proxyRequest(url.toString(), 'GET', req, res);
});

// Get Single Expense
app.get('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  await proxyRequest(`https://secure.splitwise.com/api/v3.0/get_expense/${id}`, 'GET', req, res);
});

// Create Expense
app.post('/api/expenses', async (req, res) => {
  await proxyRequest('https://secure.splitwise.com/api/v3.0/create_expense', 'POST', req, res);
});

// Update Expense
app.post('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  await proxyRequest(`https://secure.splitwise.com/api/v3.0/update_expense/${id}`, 'POST', req, res);
});

// Delete Expense
app.post('/api/expenses/:id/delete', async (req, res) => {
  const { id } = req.params;
  await proxyRequest(`https://secure.splitwise.com/api/v3.0/delete_expense/${id}`, 'POST', req, res);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Splitwise Proxy server running at http://localhost:${PORT}`);
});
