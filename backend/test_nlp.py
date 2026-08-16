import asyncio
import logging
from app.services.ai.nlp_engine import OllamaNLPEngine, Message

logging.basicConfig(level=logging.INFO)

async def test():
    engine = OllamaNLPEngine()
    
    print("--- Test Empty Context ---")
    res = await engine.chat_pipeline([], stream=False)
    print(f"Empty context response: {res}")
    
    print("--- Test Entity Resolution ---")
    context = [
        Message(role="user", content="Where is the config file?"),
        Message(role="assistant", content="It's in the backend folder."),
        Message(role="user", content="Can you open it?")
    ]
    resolved = await engine.resolve_implicit_entities(context)
    print(f"Resolved: {resolved}")
    
    print("--- Test Chat Pipeline (Stream) ---")
    stream = await engine.chat_pipeline(context, stream=True)
    async for chunk in stream:
        print(chunk, end="", flush=True)
    print("\n--- Done ---")

if __name__ == "__main__":
    asyncio.run(test())
