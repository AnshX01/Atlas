"""Circuit Breaker Dependency for FastAPI using Redis."""

from fastapi import HTTPException, status
import time
from functools import wraps
from app.infrastructure.redis_client import get_redis

class CircuitBreakerOpenException(HTTPException):
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service Temporarily Unavailable (Circuit Open)"
        )

def circuit_breaker(failure_threshold: int = 5, recovery_timeout: int = 30):
    """
    Decorator for circuit breaking external calls or fragile endpoints.
    If `failure_threshold` failures happen within `recovery_timeout`, it opens the circuit.
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            redis = get_redis()
            breaker_key = f"circuit_breaker:{func.__name__}"
            
            # Check if open
            is_open = await redis.get(f"{breaker_key}:open")
            if is_open:
                raise CircuitBreakerOpenException()
                
            try:
                result = await func(*args, **kwargs)
                # Success - reset failures
                await redis.delete(f"{breaker_key}:failures")
                return result
            except Exception as e:
                # Failure occurred
                failures = await redis.incr(f"{breaker_key}:failures")
                if failures == 1:
                    await redis.expire(f"{breaker_key}:failures", recovery_timeout)
                    
                if failures >= failure_threshold:
                    # Open the circuit
                    await redis.setex(f"{breaker_key}:open", recovery_timeout, "true")
                
                raise e
        return wrapper
    return decorator
