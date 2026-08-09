<div align="center">
  <img src="Atlas logo1.png" alt="Atlas Logo" width="200" />
  
  # Atlas
  **Your True AI Chief of Staff — 100% Local, Zero Friction, Infinite Capability.**
</div>

---

Atlas is a locally-hosted, tier-1 AI personal assistant designed to perfectly manage your digital life. Running completely on your machine for absolute privacy, it connects to your email, calendar, GitHub, and local files to read, summarize, and execute actions on your behalf.

With our new **Zero-Friction Architecture**, you no longer need to be a developer to run a cutting-edge AI assistant. Just double-click and go.

## ✨ Features

- **Tier-1 Reasoning**: Atlas understands complex, multi-turn conversations and implicit context just like ChatGPT or Gemini. ("Read the email from Sarah, and draft a polite decline.")
- **Proactive Dashboard**: Your morning briefing isn't just a list; it's a priority-sorted, glassmorphism dashboard that highlights urgent matters (like VIP emails or impending meetings) before you even ask.
- **Zero-Friction Onboarding**: Missing dependencies? Atlas features a beautiful in-app setup wizard that automatically guides you to connect to Ollama and your API tokens without crashing or confusing terminal errors.
- **Extreme Performance**: Sub-millisecond latency, instant UI rendering, and an in-memory LRU cache mean your data is always instantly available. 
- **Absolute Privacy**: All NLP and conversational logic happens locally on your machine via Ollama. 

---

## 🚀 How to Use Atlas (End-Users)

If you just want to use Atlas to manage your life, you **do not** need to touch the code! 

1. Go to the [Releases page](../../releases) on this GitHub repository.
2. Download the latest installer for your OS (`Atlas-Setup.exe` for Windows, `.dmg` for Mac, `.AppImage` for Linux).
3. Double-click the installer. 
4. Upon launching, Atlas will politely greet you and check your system. If you don't have [Ollama](https://ollama.com/) installed, the beautifully designed Onboarding Wizard will guide you through setting it up in one click.
5. Head to Settings to connect your Gmail, Notion, or GitHub accounts, and start chatting!

---

## 🛠️ How to Deploy & Build (Developers)

If you want to modify Atlas or build the binary yourself from the source code, follow these steps:

### Prerequisites
- Node.js (v18+)
- Ollama (running locally with `llama3:8b` or your preferred model)

### Build Instructions

1. **Clone the repo**:
   ```bash
   git clone https://github.com/your-username/Atlas.git
   cd Atlas/frontend
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Build the Electron Executable**:
   We use `electron-builder` to package the app. Simply run:
   ```bash
   npm run electron-build
   ```
   This will compile the Next.js frontend, bundle the Electron backend, and output a standalone `.exe` (or `.dmg`/`.AppImage` depending on your OS) into the `frontend/dist/` folder.

4. **GitHub Actions (CI/CD)**:
   This repository is already configured with a `.github/workflows/release.yml` pipeline. Every time you push a new tag (e.g., `v1.0.0`) to the `main` branch, GitHub Actions will automatically compile the app in the cloud and attach the binaries to the GitHub Release!

---

## 🔒 Architecture & Cross-Sync

Atlas uses an Electron shell wrapped around a highly optimized Next.js (React) frontend. 

- **Persistence**: All conversations and tokens are stored in a local SQLite database (`local-store.ts`), fronted by an ultra-fast LRU memory cache. This ensures data is perfectly synced across app restarts without relying on a cloud server.
- **Background Pre-fetching**: Atlas runs silent background chron jobs to pre-fetch your Gmail and keep your Model Context Protocol (MCP) servers warm. This means cross-syncing with your external services happens instantly the moment you open the app.
- **Intent Routing**: The `orchestrator.ts` parses your natural language, fixes typos via LLM pre-processing, and precisely maps it to the correct external APIs using JSON schemas.

Enjoy your new personal Chief of Staff!
