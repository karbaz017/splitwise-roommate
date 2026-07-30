# Backend API Reference

This document serves as the reference manual for the local Express proxy API server.

- **Base URL**: `http://localhost:3000`
- **Authentication**: Authentication is performed by passing a Splitwise Personal API Key inside the custom request header **`X-Splitwise-Token`** (e.g., `X-Splitwise-Token: your_key_here`). If this header is omitted, the server attempts to fall back to the `SPLITWISE_API_KEY` defined in the local `.env` file.

---

## 🔌 API Endpoints Table

| HTTP Method | Endpoint | Description | Headers Required |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/health` | Service health status check. | None |
| **GET** | `/api/user` | Fetch authenticated user details. | `X-Splitwise-Token` |
| **GET** | `/api/groups` | Fetch user's shared groups. | `X-Splitwise-Token` |
| **GET** | `/api/friends` | Fetch user's friends list and balances. | `X-Splitwise-Token` |
| **GET** | `/api/categories` | Fetch standard expense categories. | `X-Splitwise-Token` |
| **GET** | `/api/expenses` | Retrieve paginated list of transactions. | `X-Splitwise-Token` |
| **GET** | `/api/expenses/:id` | Fetch detail split of a single transaction. | `X-Splitwise-Token` |
| **POST** | `/api/expenses` | Log a new transaction or settlement payment. | `X-Splitwise-Token`, `Content-Type: application/json` |
| **POST** | `/api/expenses/:id` | Modify an existing transaction. | `X-Splitwise-Token`, `Content-Type: application/json` |
| **POST** | `/api/expenses/:id/delete`| Delete a transaction (uses POST due to Splitwise constraints). | `X-Splitwise-Token` |

---

## 📝 Request & Response Examples

### 1. Retrieve Current User Profile
* **Request:**
  ```http
  GET /api/user HTTP/1.1
  Host: localhost:3000
  X-Splitwise-Token: 1abc2def3ghi4jkl5mno
  Accept: application/json
  ```

* **Response (200 OK):**
  ```json
  {
    "user": {
      "id": 842109,
      "first_name": "Arbaz",
      "last_name": "Khan",
      "email": "arbaz.khan@temple.edu",
      "picture": {
        "medium": "https://splitwise.s3.amazonaws.com/uploads/user/avatar/842109/medium_avatar.png"
      }
    }
  }
  ```

### 2. Create Custom Split Expense
* **Request:**
  ```http
  POST /api/expenses HTTP/1.1
  Host: localhost:3000
  X-Splitwise-Token: 1abc2def3ghi4jkl5mno
  Content-Type: application/json

  {
    "cost": "15.00",
    "description": "Laundry Detergent",
    "group_id": 98765,
    "category_id": 18,
    "date": "2026-07-30",
    "users__0__user_id": 842109,
    "users__0__paid_share": "15.00",
    "users__0__owed_share": "5.00",
    "users__1__user_id": 554321,
    "users__1__paid_share": "0.00",
    "users__1__owed_share": "5.00",
    "users__2__user_id": 998877,
    "users__2__paid_share": "0.00",
    "users__2__owed_share": "5.00"
  }
  ```

* **Response (200 OK):**
  ```json
  {
    "expenses": [
      {
        "id": 1234567,
        "description": "Laundry Detergent",
        "cost": "15.00",
        "date": "2026-07-30T00:00:00Z",
        "users": [
          {
            "user_id": 842109,
            "paid_share": "15.00",
            "owed_share": "5.00"
          },
          {
            "user_id": 554321,
            "paid_share": "0.00",
            "owed_share": "5.00"
          },
          {
            "user_id": 998877,
            "paid_share": "0.00",
            "owed_share": "5.00"
          }
        ],
        "errors": {}
      }
    ]
  }
  ```

---

## ❌ HTTP Error Codes

The API routes propagate errors directly from Splitwise or return proxy validations.

- **`401 Unauthorized`**:
  Returned when the authentication key is missing or invalid.
  ```json
  {
    "error": "unauthorized",
    "message": "Splitwise API Key is missing. Please provide it via the X-Splitwise-Token header or configure SPLITWISE_API_KEY in the server's .env file."
  }
  ```

- **`400 Bad Request`**:
  Returned when payload validation fails (e.g. user shares do not add up to total cost).
  ```json
  {
    "errors": {
      "base": [
        "The paid share sum (10.00) does not equal cost (15.00)."
      ]
    }
  }
  ```

- **`500 Internal Server Error`**:
  Returned when server connection limits fail.
  ```json
  {
    "error": "proxy_error",
    "message": "Failed to fetch resource from secure.splitwise.com"
  }
  ```
