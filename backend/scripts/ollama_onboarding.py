import os
import sys
import shutil
import platform
import subprocess
import urllib.request
import time
import json
from urllib.error import URLError

OLLAMA_API_URL = "http://127.0.0.1:11434"

def print_step(step):
    print(f"\n[*] {step}")

def print_success(msg):
    print(f"[+] {msg}")

def print_error(msg):
    print(f"[-] {msg}")

def check_system():
    print_step("System Check")
    os_name = platform.system()
    arch = platform.machine()
    print(f"    OS: {os_name}")
    print(f"    Architecture: {arch}")
    
    if os_name != "Windows":
        print_error("This specific script flow is optimized for Windows. Continuing anyway, but installation might fail.")
    return os_name

def check_ollama_server():
    try:
        req = urllib.request.Request(f"{OLLAMA_API_URL}/api/version")
        with urllib.request.urlopen(req, timeout=2) as response:
            if response.status == 200:
                data = json.loads(response.read().decode())
                return True, data.get("version", "unknown")
    except (URLError, ConnectionError):
        return False, None
    return False, None

def detect_ollama():
    print_step("Detecting Ollama Installation")
    ollama_path = shutil.which("ollama")
    if ollama_path:
        print_success(f"Ollama executable found at: {ollama_path}")
        is_running, version = check_ollama_server()
        if is_running:
            print_success(f"Ollama server is running (version {version})")
            return True, True
        else:
            print_error("Ollama executable found, but the server is NOT running.")
            return True, False
    else:
        # Check standard installation paths as fallback
        fallback_path = os.path.expandvars(r"%LOCALAPPDATA%\Programs\Ollama\ollama.exe")
        if os.path.exists(fallback_path):
            print_success(f"Ollama executable found at fallback path: {fallback_path}")
            is_running, version = check_ollama_server()
            if is_running:
                print_success(f"Ollama server is running (version {version})")
                return True, True
            else:
                print_error("Ollama executable found, but the server is NOT running.")
                return True, False
            
        print_error("Ollama is not installed.")
        return False, False

def install_ollama(os_name):
    print_step("Ollama Installation Flow")
    if os_name == "Windows":
        installer_url = "https://ollama.com/download/OllamaSetup.exe"
        installer_path = os.path.join(os.environ.get("TEMP", "."), "OllamaSetup.exe")
        
        print(f"    Downloading Ollama installer from {installer_url}...")
        try:
            urllib.request.urlretrieve(installer_url, installer_path)
            print_success("Download complete.")
            
            print("    Launching Ollama installer. Please complete the installation in the GUI window.")
            # We run it and wait. The installer might require user interaction.
            subprocess.run([installer_path], check=True)
            print_success("Installation process finished.")
            return True
        except Exception as e:
            print_error(f"Installation failed: {e}")
            return False
    else:
        print_error(f"Automatic installation not implemented for {os_name} in this script.")
        print("Please visit https://ollama.com/download to install it manually.")
        return False

def handshake():
    print_step("Connection Handshake")
    print("    Waiting for Ollama server to become available...")
    max_retries = 15
    for i in range(max_retries):
        is_running, version = check_ollama_server()
        if is_running:
            print_success(f"Handshake successful! Connected to Ollama version {version}.")
            
            # Fetch tags
            try:
                req = urllib.request.Request(f"{OLLAMA_API_URL}/api/tags")
                with urllib.request.urlopen(req, timeout=2) as response:
                    data = json.loads(response.read().decode())
                    models = [m.get("name") for m in data.get("models", [])]
                    print(f"    Available models ({len(models)}): {', '.join(models) if models else 'None'}")
            except Exception as e:
                print_error(f"Could not fetch models: {e}")
                
            return True
        time.sleep(2)
        print("    Waiting...")
        
    print_error("Handshake failed. Ollama server did not start in time.")
    return False

def main():
    print("=== Agent Onboarding Wizard ===")
    os_name = check_system()
    
    is_installed, is_running = detect_ollama()
    
    if not is_installed:
        print("\nOllama is required for local inference.")
        choice = input("Would you like to download and install Ollama now? (y/n): ").strip().lower()
        if choice == 'y':
            success = install_ollama(os_name)
            if not success:
                print_error("Aborting setup due to installation failure.")
                sys.exit(1)
        else:
            print_error("Ollama installation skipped. Setup blocked.")
            sys.exit(1)
            
    if not is_running:
        print("\nOllama server is not running.")
        print("Attempting to start Ollama server...")
        try:
            # On Windows, running `ollama serve` in background
            if os_name == "Windows":
                # Using CREATE_NO_WINDOW to run silently in background
                subprocess.Popen(["ollama", "serve"], creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print_error(f"Failed to start Ollama automatically: {e}")
            print("Please start it manually by running 'ollama serve'")
            
    # Always handshake at the end
    handshake()
    
    print("\n=== Setup Complete ===")

if __name__ == "__main__":
    main()
