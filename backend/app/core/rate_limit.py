"""Rate Limiting Dependency for FastAPI using Redis."""

from fastapi import HTTPException, Request, status
import time
import uuid
from app.infrastructure.redis_client import get_redis

class RateLimiter:
    def __init__(self, times: int = 10, seconds: int = 60):
        self.times = times
        self.seconds = seconds

    async def __call__(self, request: Request):
        redis = get_redis()
        client_ip = request.client.host if request.client else "unknown"
        key = f"rate_limit:{request.url.path}:{client_ip}"
        
        current = int(time.time())
        window_start = current - self.seconds
        
        # Redis sorted set for sliding window
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, 0, window_start)
            pipe.zcard(key)
            # Need a unique member name for ZADD
            member = f"{current}:{uuid.uuid4()}"
            pipe.zadd(key, {member: current})
            pipe.expire(key, self.seconds)
            results = await pipe.execute()
            
        request_count = results[1]
        
        if request_count >= self.times:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too Many Requests"
            )
