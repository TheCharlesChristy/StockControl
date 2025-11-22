"""
Redis configuration and connection management.
"""
import logging
from typing import Optional, Any
import json
from redis import Redis, ConnectionPool, RedisError
from .config import settings

logger = logging.getLogger(__name__)

# Constants
CACHE_BATCH_SIZE = 100  # Number of keys to delete in a single batch

# Global Redis connection pool
_redis_pool: Optional[ConnectionPool] = None
_redis_client: Optional[Redis] = None


def get_redis_pool() -> Optional[ConnectionPool]:
    """
    Get or create Redis connection pool.
    
    Returns:
        ConnectionPool: Redis connection pool or None if not configured
    """
    global _redis_pool
    
    if _redis_pool is None and settings.REDIS_URL:
        try:
            _redis_pool = ConnectionPool.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                max_connections=10
            )
            logger.info("Redis connection pool created")
        except Exception as e:
            logger.error(f"Failed to create Redis connection pool: {e}")
            return None
    
    return _redis_pool


def get_redis() -> Optional[Redis]:
    """
    Get Redis client instance.
    
    Returns:
        Redis: Redis client or None if not configured
        
    Usage:
        redis_client = get_redis()
        if redis_client:
            redis_client.set("key", "value")
    """
    global _redis_client
    
    if _redis_client is None:
        pool = get_redis_pool()
        if pool:
            _redis_client = Redis(connection_pool=pool)
            logger.info("Redis client created")
    
    return _redis_client


def close_redis() -> None:
    """
    Close Redis connection pool.
    Should be called on application shutdown.
    """
    global _redis_pool, _redis_client
    
    if _redis_client:
        _redis_client.close()
        _redis_client = None
        logger.info("Redis client closed")
    
    if _redis_pool:
        _redis_pool.disconnect()
        _redis_pool = None
        logger.info("Redis connection pool closed")


def check_redis_health() -> bool:
    """
    Check Redis connection health.
    
    Returns:
        bool: True if Redis is accessible, False otherwise
    """
    redis_client = get_redis()
    if redis_client is None:
        return False
    
    try:
        return redis_client.ping() is True
    except RedisError as e:
        logger.error(f"Redis health check failed: {e}")
        return False


# Caching utilities

def get_cached(key: str) -> Optional[Any]:
    """
    Get cached value by key.
    
    Args:
        key: Cache key
        
    Returns:
        Cached value (parsed from JSON) or None if not found or error
        
    Usage:
        cached_data = get_cached("user:123")
        if cached_data:
            return cached_data
    """
    redis_client = get_redis()
    if redis_client is None:
        return None
    
    try:
        value = redis_client.get(key)
        if value is not None:
            return json.loads(value)
        return None
    except (RedisError, json.JSONDecodeError) as e:
        logger.error(f"Failed to get cached value for key '{key}': {e}")
        return None


def set_cached(key: str, value: Any, expire: Optional[int] = None) -> bool:
    """
    Set cached value with optional expiration.
    
    Args:
        key: Cache key
        value: Value to cache (will be JSON serialized)
        expire: Expiration time in seconds (optional)
        
    Returns:
        bool: True if successful, False otherwise
        
    Usage:
        set_cached("user:123", {"name": "John"}, expire=3600)
    """
    redis_client = get_redis()
    if redis_client is None:
        return False
    
    try:
        serialized = json.dumps(value)
        result = redis_client.set(key, serialized, ex=expire)
        return bool(result)
    except (RedisError, TypeError, json.JSONEncodeError) as e:
        logger.error(f"Failed to set cached value for key '{key}': {e}")
        return False


def invalidate_cache(key: str) -> bool:
    """
    Invalidate (delete) cached value by key.
    
    Args:
        key: Cache key to invalidate
        
    Returns:
        bool: True if key was deleted, False if key didn't exist or error occurred
        
    Usage:
        invalidate_cache("user:123")
    """
    redis_client = get_redis()
    if redis_client is None:
        return False
    
    try:
        deleted_count = redis_client.delete(key)
        return deleted_count > 0
    except RedisError as e:
        logger.error(f"Failed to invalidate cache for key '{key}': {e}")
        return False


def invalidate_cache_pattern(pattern: str) -> int:
    """
    Invalidate all cached values matching a pattern.
    
    Args:
        pattern: Cache key pattern (e.g., "user:*")
        
    Returns:
        int: Number of keys deleted, or -1 on error
        
    Usage:
        invalidate_cache_pattern("user:*")
        
    Note:
        Uses SCAN to avoid blocking Redis in production.
        Deletes keys in batches using pipeline for efficiency.
    """
    redis_client = get_redis()
    if redis_client is None:
        return -1
    
    try:
        deleted_count = 0
        keys_to_delete = []
        
        # Collect keys in batches and delete them
        for key in redis_client.scan_iter(match=pattern, count=CACHE_BATCH_SIZE):
            keys_to_delete.append(key)
            # Delete in batches
            if len(keys_to_delete) >= CACHE_BATCH_SIZE:
                pipe = redis_client.pipeline()
                pipe.delete(*keys_to_delete)
                results = pipe.execute()
                # Check if delete succeeded (results[0] should be count of deleted keys)
                if results and len(results) > 0:
                    deleted_count += results[0]
                keys_to_delete = []
        
        # Delete remaining keys
        if keys_to_delete:
            pipe = redis_client.pipeline()
            pipe.delete(*keys_to_delete)
            results = pipe.execute()
            # Check if delete succeeded
            if results and len(results) > 0:
                deleted_count += results[0]
        
        return deleted_count
    except RedisError as e:
        logger.error(f"Failed to invalidate cache pattern '{pattern}': {e}")
        return -1
