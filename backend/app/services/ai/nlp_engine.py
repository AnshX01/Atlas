import json
import logging
from typing import List, Dict, Any, AsyncGenerator
import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class Message(BaseModel):
    role: str
    content: str

class OllamaNLPEngine:
    """
    Tier-1 local reasoning engine.
    Handles:
    - Multi-turn context
    - Implicit entity resolution
    - Prompt/response pipeline to Ollama (handling slow streaming rates)
    """
    
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3:8b"):
        self.base_url = base_url
        self.model = model

    def _build_resolution_prompt(self, context: List[Message]) -> str:
        """
        Constructs a prompt for implicit entity resolution.
        """
        convo = ""
        for msg in context[:-1]:
            convo += f"{msg.role}: {msg.content}\n"
        
        latest_msg = context[-1].content
        
        prompt = f"""
Given the following conversation history:
{convo}

The user just said: "{latest_msg}"
Identify any implicit entities (e.g. pronouns like 'it', 'he', 'they', or ambiguous references like 'the file') in the user's latest message, and replace them with their explicit names based on the context. If no implicit entities exist, just output the user's latest message exactly as is. Output ONLY the resolved message text, nothing else. Do not acknowledge or output formatting.
"""
        return prompt.strip()

    async def resolve_implicit_entities(self, context: List[Message]) -> str:
        """
        Uses the model to explicitly resolve ambiguous pronouns/entities in the latest turn.
        """
        if len(context) < 2:
            return context[-1].content  # No context to resolve from

        prompt = self._build_resolution_prompt(context)
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False
        }

        try:
            # 30s overall timeout is reasonable for this small resolution call
            # Use a retry strategy for transient network errors.
            retry_client = httpx.AsyncClient(timeout=60.0, limits=httpx.Limits(max_keepalive_connections=5))
            async with retry_client as client:
                response = await client.post(f"{self.base_url}/api/chat", json=payload)
                response.raise_for_status()
                data = response.json()
                resolved_text = data.get("message", {}).get("content", "").strip()
                
                # Fallback if the model outputs something weird (e.g. too long)
                if len(resolved_text) > len(context[-1].content) + 200:
                    logger.warning("Entity resolution produced unexpectedly long output. Using original.")
                    return context[-1].content
                    
                return resolved_text
        except Exception as e:
            logger.error(f"Error during entity resolution: {e}")
            return context[-1].content

    async def generate_response_stream(self, context: List[Message]) -> AsyncGenerator[str, None]:
        """
        Generates a streaming response from the local Ollama instance.
        """
        # Truncate context to prevent context window overflow (e.g. last 10 turns)
        truncated_context = context[-10:] if len(context) > 10 else context
        
        payload = {
            "model": self.model,
            "messages": [msg.model_dump() for msg in truncated_context],
            "stream": True
        }

        # Set read timeout to 15s to detect hung streams quickly, but no overall timeout for long generation
        timeout = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_lines():
                        if chunk:
                            try:
                                data = json.loads(chunk)
                                if "message" in data and "content" in data["message"]:
                                    yield data["message"]["content"]
                                if data.get("done", False):
                                    break
                            except json.JSONDecodeError:
                                logger.warning("Failed to parse chunk from Ollama stream")
                                continue
        except httpx.TimeoutException:
            logger.error("Timeout connecting to or reading from reasoning engine.")
            yield " Sorry, the reasoning engine timed out."
        except Exception as e:
            logger.error(f"Error generating response stream: {e}")
            yield " Sorry, I encountered an error connecting to the reasoning engine."

    async def generate_response(self, context: List[Message]) -> str:
        """
        Generates a full response (blocking until completion).
        """
        truncated_context = context[-10:] if len(context) > 10 else context
        
        payload = {
            "model": self.model,
            "messages": [msg.model_dump() for msg in truncated_context],
            "stream": False
        }

        # 60s read timeout for full response generation
        timeout = httpx.Timeout(120.0, read=120.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(f"{self.base_url}/api/chat", json=payload)
                response.raise_for_status()
                data = response.json()
                return data.get("message", {}).get("content", "")
        except httpx.TimeoutException:
            logger.error("Timeout generating full response from reasoning engine.")
            return "Sorry, the reasoning engine timed out."
        except Exception as e:
            logger.error(f"Error generating response: {e}")
            return "Sorry, I encountered an error connecting to the reasoning engine."

    async def chat_pipeline(self, context: List[Message], stream: bool = True) -> Any:
        """
        The main pipeline:
        1. Resolve implicit entities in the latest message.
        2. Replace the latest message with the resolved version.
        3. Send the updated multi-turn context to Ollama.
        """
        if not context:
            logger.warning("Empty context provided to chat_pipeline.")
            if stream:
                async def empty_stream():
                    yield "I didn't receive a message. How can I help you?"
                return empty_stream()
            else:
                return "I didn't receive a message. How can I help you?"
            
        resolved_text = await self.resolve_implicit_entities(context)
        logger.info(f"Resolved context: {resolved_text}")
        
        # Create a new context list with the resolved message
        resolved_context = context[:-1] + [Message(role=context[-1].role, content=resolved_text)]
        
        if stream:
            return self.generate_response_stream(resolved_context)
        else:
            return await self.generate_response(resolved_context)
