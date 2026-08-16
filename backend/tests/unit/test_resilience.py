import pytest
from unittest.mock import AsyncMock, patch
from fastapi import Request, HTTPException, status
import time

from app.core.rate_limit import RateLimiter
from app.core.circuit_breaker import circuit_breaker, CircuitBreakerOpenException

@pytest.mark.asyncio
async def test_rate_limiter_success():
    limiter = RateLimiter(times=5, seconds=60)
    
    mock_redis = AsyncMock()
    mock_pipe = AsyncMock()
    # Execute returns [zrem, zcard (count of elements), zadd, expire]
    mock_pipe.execute.return_value = [1, 2, 1, 1]  # 2 requests so far
    
    # Setup context manager for pipeline
    mock_pipe.__aenter__.return_value = mock_pipe
    mock_redis.pipeline.return_value = mock_pipe
    
    request = Request({"type": "http", "client": ("127.0.0.1", 8000), "path": "/search"})
    
    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        # Should not raise
        await limiter(request)

@pytest.mark.asyncio
async def test_rate_limiter_blocks():
    limiter = RateLimiter(times=5, seconds=60)
    
    mock_redis = AsyncMock()
    mock_pipe = AsyncMock()
    # Execute returns [zrem, zcard (count of elements), zadd, expire]
    mock_pipe.execute.return_value = [1, 6, 1, 1]  # 6 requests so far
    
    mock_pipe.__aenter__.return_value = mock_pipe
    mock_redis.pipeline.return_value = mock_pipe
    
    request = Request({"type": "http", "client": ("127.0.0.1", 8000), "path": "/search"})
    
    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        with pytest.raises(HTTPException) as exc:
            await limiter(request)
        assert exc.value.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_circuit_breaker_success():
    @circuit_breaker(failure_threshold=3, recovery_timeout=60)
    async def my_func():
        return "success"
        
    mock_redis = AsyncMock()
    mock_redis.get.return_value = None # Not open
    
    with patch("app.core.circuit_breaker.get_redis", return_value=mock_redis):
        res = await my_func()
        assert res == "success"
        mock_redis.delete.assert_called_once()

@pytest.mark.asyncio
async def test_circuit_breaker_opens_on_failure():
    @circuit_breaker(failure_threshold=3, recovery_timeout=60)
    async def my_func():
        raise ValueError("fail")
        
    mock_redis = AsyncMock()
    mock_redis.get.return_value = None # Not open
    mock_redis.incr.return_value = 3 # threshold reached
    
    with patch("app.core.circuit_breaker.get_redis", return_value=mock_redis):
        with pytest.raises(ValueError):
            await my_func()
        
        mock_redis.setex.assert_called_once_with(f"circuit_breaker:my_func:open", 60, "true")

@pytest.mark.asyncio
async def test_circuit_breaker_already_open():
    @circuit_breaker(failure_threshold=3, recovery_timeout=60)
    async def my_func():
        return "success"
        
    mock_redis = AsyncMock()
    mock_redis.get.return_value = b"true" # Open
    
    with patch("app.core.circuit_breaker.get_redis", return_value=mock_redis):
        with pytest.raises(CircuitBreakerOpenException):
            await my_func()
