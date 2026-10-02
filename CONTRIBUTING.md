# Contributing to splitwise-roommate

First off, thank you for taking the time to contribute! 🎉 Contributions are what make the open source community such an amazing place to learn, inspire, and create.

Please read our **[Code of Conduct](CODE_OF_CONDUCT.md)** to ensure a welcoming environment for everyone.

---

## 🐛 How to Report Bugs
- Use the search bar in the **[GitHub Issues](https://github.com/karbaz017/splitwise-roommate/issues)** tab to make sure the bug hasn't already been reported.
- If it's a new issue, submit a new bug report using the template.
- Include a clear description of the bug, reproduction steps, expected behavior, and relevant environment information (OS, Node version, browser).

## 💡 How to Suggest Features
- Check the **[Issues page](https://github.com/karbaz017/splitwise-roommate/issues)** to see if the feature has already been suggested or planned.
- Open a feature request issue containing the problem statement, proposed solution, and why it benefits users.

---

## 💻 Dev Environment Setup

1. **Fork and Clone:**
   Fork the repository and clone your fork locally:
   ```bash
   git clone https://github.com/karbaz017/splitwise-roommate.git
   cd splitwise-roommate
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```
   All values are optional (see the README configuration table).

4. **Run Development Server:**
   ```bash
   npm run dev      # start with auto-restart
   npm test         # run tests before opening a PR
   npm run lint
   ```

---

## 🎨 Code Style Guide

To maintain a clean and readable codebase, please adhere to these standards:
- **Language**: Modern ES6+ Javascript.
- **Indentation**: 2-space indent (no tabs).
- **Formatting**: End lines with semicolons where appropriate.
- **Variables**: Use `const` and `let` only; do **not** use `var`.
- **Comments**: Keep comments clear, describing non-obvious code logic or design contexts.

---

## 🧪 Testing Requirements

Before submitting changes, write tests or verify manually. To run automated tests (if implemented):
```bash
npm test
```
Make sure all checks pass, and there are no linting or syntax errors.

---

## 📝 Commit Message Format

We follow the **Conventional Commits** standard. Commit messages must be structured as follows:
```
<type>(<scope>): <short summary>
```

### Allowed Types:
- `feat`: A new feature.
- `fix`: A bug fix.
- `docs`: Documentation updates.
- `style`: Changes that do not affect code logic (formatting, spacing).
- `refactor`: Code changes that neither fix a bug nor add a feature.
- `test`: Adding or correcting tests.
- `chore`: Updates to build steps, dependencies, or config configurations.

---

## 🔄 Pull Request Process

Follow these 5 steps to submit your PR:

1. **Create a Topic Branch:** Create a branch named after the feature or fix you are making:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Implement Your Changes:** Write clean code conforming to the style guide, test it, and commit with conventional messages.
3. **Keep in Sync:** Pull the latest main updates into your branch and resolve any conflicts:
   ```bash
   git checkout main
   git pull origin main
   git checkout feat/your-feature-name
   git merge main
   ```
4. **Push Your Branch:** Push changes to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
5. **Open Pull Request:** Navigate to the original repository and open a Pull Request using the PR template.

---

## 📂 Project Structure Overview

```
splitwise-roommate/
├── server.js             # Entry point
├── src/                  # money (split engine), ledger (validation), store, receipts, splitwise (optional import), app (routes)
├── public/               # Frontend (vanilla ES modules)
│   ├── index.html
│   ├── css/              # style.css (base) + ledger.css
│   └── js/               # app, api, receipts (drop/paste), ocr, receipt-parser, util
├── test/                 # node:test suites
├── docs/
└── .github/              # Issue/PR templates, CI
```

---

## ❓ Questions & Support
If you have questions, please reach out by opening a question issue, or email the maintainer at **[arbaz.khan@temple.edu](mailto:arbaz.khan@temple.edu)**.
