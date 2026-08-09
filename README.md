<div align="center">
  <img src="Atlas logo1.png" alt="Atlas Logo" width="200" />
  
  # Atlas
  **Your True AI Chief of Staff — 100% Local Processing, Cloud-Synced, Infinite Capability.**
</div>

---

Atlas is a Tier-1 AI personal assistant running entirely on your local machine using Ollama. It reads your email, manages your calendar, controls your GitHub, and acts on your behalf perfectly, with all the beautiful aesthetics and fluid interactions of a native macOS application.

## ✨ Features

- **Tier-1 NLP Engine**: Complex, multi-turn reasoning and implicit entity resolution.
- **Cross-Device Cloud Sync**: Using an offline-first Supabase architecture, your conversations and integration tokens (securely encrypted) instantly sync across all your devices.
- **Apple-Tier Aesthetic**: An incredibly smooth, responsive UI featuring permanent top-bar command palettes, `Inter` typography, and pristine Monterey-style glassmorphism.
- **Rage-Click Defense**: A completely indestructible interface protected against overlapping layout shifts and rapid UI clicks.

---

## 🚀 How to Download & Use Atlas

You do not need to be a developer to run Atlas. Just follow this step-by-step tutorial:

### Step 1: Download the App
1. Navigate to the [Releases](../../releases) tab on this GitHub repository.
2. Download the latest installer for your operating system (e.g., `Atlas-Setup.exe` for Windows, `.dmg` for Mac).
3. Double-click to install and launch Atlas.

### Step 2: The Onboarding Wizard
1. The first time you launch Atlas, it will verify your system.
2. **If you do not have an AI engine installed**, a beautiful glassmorphism wizard will pop up and guide you through downloading **Ollama** in one click.
3. Once Ollama is running in the background, Atlas will instantly connect to it.

### Step 3: Connect Your Digital Life
1. Log into Atlas using your email. Your secure session will initialize the cloud sync.
2. Open the **Settings** menu.
3. You will see colored icons for integrations like **Gmail**, **Notion**, and **GitHub**. Click them to authenticate.
4. *Security Note:* When you connect an integration, your OAuth tokens are instantly encrypted before being stored, ensuring complete privacy.

### Step 4: Talk to Your Chief of Staff
1. Go to the **Chat** tab.
2. Use the permanent **Top-Bar Command Palette** to navigate or issue quick commands.
3. Type natural language commands like: *"Read my latest emails from Sarah, and draft a polite decline."*
4. Enjoy your new life with a perfectly synced, hyper-intelligent assistant.

---

## 🛠️ Developer Deployment (GitHub Actions)

If you are modifying Atlas or want to release a new version for your users, the deployment is entirely automated via GitHub Actions.

### Environment Variables & Secrets
To enable the Cloud Sync (Supabase) architecture for your end-users, you must provide the GitHub Actions runner with your Supabase credentials so they can be baked into the `.exe`.

1. Go to your GitHub Repository **Settings** > **Secrets and variables** > **Actions**.
2. Click **New repository secret**.
3. Add the following secrets:
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase Anon Key.
   - *(Any other integration Client IDs, if necessary).*

### Releasing a New Version
Once your secrets are set:
1. Push your code to the `main` branch.
2. Create and push a new git tag (e.g., `v2.0.0`):
   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```
3. GitHub Actions will automatically spin up Windows, Mac, and Linux runners, cross-compile the application, and publish the `.exe`, `.dmg`, and `.AppImage` files to your Releases page!
