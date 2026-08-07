# **Local Agentic Hub: Migration & Implementation Plan V3 (Electron Desktop App)**

This document outlines the architectural refactoring and implementation roadmap to transition your existing **Electron.js Desktop Application**—currently powered by the cloud OpenAI (ChatGPT) API and direct third-party API connectors—into a privacy-focused, 100% local-first desktop workflow orchestration hub using **Ollama**, **LangGraph**, an **Electron-native Chatbot Interface**, and **Model Context Protocol (MCP)** servers.

## **1\. Executive Summary & Desktop Architecture Strategy**

By leveraging Electron.js as a native desktop wrapper, the application gains direct access to OS-level primitives, native process management, system tray execution, and offline local storage. Instead of calling cloud AI endpoints or remote webhooks, the Electron main process will directly manage local background subprocesses (Ollama LLM daemon and stdio-based MCP servers for Google Workspace, Slack, Notion, GitHub, and local filesystem access). The Chromium renderer process houses an interactive Chatbot UI that communicates securely with the LangGraph orchestrator via Electron Inter-Process Communication (IPC).

## **2\. Architectural Comparison**

| Component | Current Cloud Architecture | Target Electron Desktop Architecture (V3)   |
| :---- | :---- | :---- |
| **Application Environment** | Web/Cloud-bound App | Electron.js Native Desktop App (Node.js Main \+ Chromium Renderer) |
| **LLM Provider** | OpenAI API (GPT-4 / GPT-4o) | Local Ollama Daemon (Llama 3.1 / Qwen 2.5) managed by Electron Main |
| **Chatbot Interface** | HTTP API-based Chat UI | Electron Renderer UI connected via Secure IPC Bridge (preload.js) |
| **Orchestration Engine** | Direct OpenAI API wrapper / Prompt logic | LangGraph StateGraph Engine (embedded in local Python/Node background runtime) |
| **Integrations Layer** | Direct cloud REST API & SDK calls | Local MCP Tool Servers (spawned as stdio subprocesses by Electron Main) |
| **State & Storage** | Remote App DB / Session Memory | Local SQLite Database (via LangGraph SqliteSaver) in OS appData directory |

## **3\. Electron Desktop Integration & Local Process Lifecycle**

### **A. Desktop Subprocess Management**

The Electron Main process serves as the master orchestrator for all local services:

> * **Ollama Health Check & Launcher:** On app launch, Electron verifies if the local Ollama service is active. If down, Electron can launch it in the background or alert the user.  
> * **MCP Server Subprocess Supervision:** Electron main process uses Node.js child\_process.spawn to spin up stdio-based local MCP servers (Google Workspace, Slack, Notion, GitHub, Filesystem) during desktop boot and gracefully terminates them on app exit.  
> * **Secure IPC Communication:** The Chatbot UI in the Chromium renderer communicates with LangGraph through an isolated Context Bridge (preload.js), preventing unsafe node integration in the frontend.

### **B. Desktop-Optimized Workflows & Native OS Features**

> * **System Tray & Background Workflows:** The desktop app can run minimized in the system tray, periodically fetching unread Slack messages, Google Calendar events, and GitHub issues via local MCP tools, and alerting you via OS native notifications.  
> * **Native File System Access:** Direct file drag-and-drop into the desktop chatbot window to process local documents, code bases, and configuration files via the filesystem MCP server.  
> * **Morning Briefing & Agenda Synthesis:**  
>   *Prompt:* "Give me my daily briefing: check unread emails, today's calendar events, and urgent Slack DMs."  
>   *Action:* Chatbot triggers local MCP tools, synthesizes the result locally via Ollama, and pops an OS desktop notification with action items.  
> * **Cross-App Task Automation:**  
>   *Prompt:* "Summarize Slack thread \#engineering-bugs and create a card in Notion, then update local project notes."  
>   *Action:* Electron orchestrates local MCP server tool calls across Slack, Notion, and local file storage without sending data outside your device.

### **C. Electron IPC & Chatbot Stream Pipeline**

> 1. **User Input (Renderer):** User types a workflow request into the Electron Chatbot UI.  
> 2. **IPC Dispatch:** Renderer sends command via window.electronAPI.sendPrompt(payload).  
> 3. **LangGraph Processing (Main/Local Backend):** The main process routes the request through the LangGraph StateGraph engine backed by local Ollama model inferences.  
> 4. **MCP Tool Execution:** LangGraph invokes stdio tool calls on the locally running MCP server processes.  
> 5. **Human-in-the-Loop Dialog:** If a sensitive tool call requires approval (e.g., sending email, posting to Slack), Electron presents a native confirmation modal/drawer in the desktop app UI.  
> 6. **Stream to Renderer:** Output text and status streams live back to the Renderer via ipcRenderer.on('chat-stream').

## **4\. Phased Implementation Roadmap for Desktop App**

### **Phase 1: Electron Main Process & Ollama Engine Setup**

Configure the desktop app environment to manage local AI dependencies natively.

> * **Ollama Integration:** Configure Electron Main process to verify Ollama availability at startup (default localhost:11434). Support models like qwen2.5:14b or llama3.1:8b.  
> * **Backend Adapter Replacement:** Replace cloud OpenAI endpoints with local ChatOllama calls handled inside the desktop application backend layer.  
> * **IPC Bridge Configuration:** Implement secure contextBridge handlers in preload.js for bidirectional streaming between Renderer and Main process.

### **Phase 2: Local MCP Server Management in Electron**

Transition direct API connectors into stdio MCP servers launched as subprocesses by Electron.

| Service Connector | Electron Subprocess Strategy | Target MCP Tools   |
| :---- | :---- | :---- |
| **Google Workspace** | Spawn local FastMCP Python binary storing tokens in local OS keychain / appData | read\_emails, send\_email, list\_calendar\_events, create\_event |
| **Slack** | Spawn local Node stdio Slack MCP process | post\_channel\_message, read\_unread\_messages, send\_dm |
| **Notion** | Spawn open-source Notion MCP server process | query\_database, append\_block, create\_task\_page |
| **GitHub** | Spawn official GitHub MCP stdio process using local PAT | get\_assigned\_issues, create\_pull\_request, search\_repo |
| **Local Filesystem** | Spawn native filesystem MCP server pointing to selected local workspace directory | read\_file, write\_file, list\_directory |

### **Phase 3: LangGraph Orchestrator & Local Persistence**

Embed LangGraph inside the local app backend to manage execution graphs, tool execution, and local database state.

> 1. **MCP Client Adapter:** Register active stdio MCP subprocesses into langchain-mcp-adapters dynamically.  
> 2. **StateGraph Construction:**  
   * **Supervisor/Router Node:** Routes prompts to specific tool execution paths or direct LLM responses.  
   * **Execution Node:** Dispatches tool parameters to stdio MCP channels.  
   * **Human Approval Node:** Pauses workflow graph execution and emits an IPC event to request user approval in the desktop UI.  
> 3. **OS AppData Persistence:** Initialize SqliteSaver pointing to app.getPath('userData')/workflows.db for durable state persistence across app restarts.

### **Phase 4: Electron Desktop UI & Native Integration**

Refactor the Chatbot frontend to leverage Electron desktop UI capabilities.

> * **Desktop Chatbot Drawer:** Embedded sidebar or full-page chat interface supporting token streaming via IPC listeners.  
> * **Interactive Action Cards:** Render inline UI widgets for tool execution previews and "Approve/Cancel" action controls.  
> * **System Tray & Status Monitor:** Tray icon menu showing active MCP subprocesses, Ollama memory usage, and background job status.

## **5\. Desktop Architecture Code Structure Example**

// main.js (Electron Main Process)  
const { app, BrowserWindow, ipcMain } \= require('electron');  
const path \= require('path');  
const { spawn } \= require('child\_process');

let mainWindow;  
let mcpSubprocesses \= \[\];

// 1\. Launch Local MCP Server Subprocesses on Desktop Boot  
function startMCPServers() {  
  const googleMCP \= spawn('python', \['-m', 'mcp\_server\_google'\]);  
  const slackMCP \= spawn('npx', \['-y', '@modelcontextprotocol/server-slack'\]);  
  mcpSubprocesses.push(googleMCP, slackMCP);  
}

// 2\. Setup Secure IPC Handler for Desktop Chatbot  
ipcMain.handle('send-chatbot-message', async (event, userPrompt) \=\> {  
  // Pass prompt to local LangGraph \+ ChatOllama engine running locally  
  const responseStream \= await runLocalLangGraphWorkflow(userPrompt);  
    
  for await (const chunk of responseStream) {  
    mainWindow.webContents.send('chatbot-token-stream', chunk);  
  }  
});

app.whenReady().then(() \=\> {  
  startMCPServers();  
  createWindow();  
});

app.on('will-quit', () \=\> {  
  mcpSubprocesses.forEach(proc \=\> proc.kill());  
});

## **6\. Key Milestones & Rollout Sequence**

> 1. **Milestone 1:** Configure Electron Main process to verify Ollama daemon and test IPC streaming with ChatOllama.  
> 2. **Milestone 2:** Implement Electron subprocess manager to spawn and monitor local stdio MCP servers (Google Workspace, Slack, Notion, GitHub, Filesystem).  
> 3. **Milestone 3:** Build LangGraph orchestrator backed by local SQLite persistence in OS userData.  
> 4. **Milestone 4:** Upgrade Chatbot Renderer UI with native inline approval cards for Human-in-the-Loop workflows.  
> 5. **Milestone 5:** Add System Tray support, native desktop notifications, and fully remove cloud OpenAI API dependencies.