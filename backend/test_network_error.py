import asyncio
import logging
from app.services.ai.nlp_engine import OllamaNLPEngine, Message

logging.basicConfig(level=logging.INFO)

async def test():
    engine = OllamaNLPEngine(base_url="http://localhost:9999") # wrong port
    context = [Message(role="user", content="Hello")]
    
    print("Testing generate_response (non-stream):")
    res = await engine.chat_pipeline(context, stream=False)
    print(res)

    print("\nTesting generate_response_stream (stream):")
    res_stream = await engine.chat_pipeline(context, stream=True)
    async for chunk in res_stream:
        print(chunk, end="", flush=True)

if __name__ == "__main__":
    asyncio.run(test())
