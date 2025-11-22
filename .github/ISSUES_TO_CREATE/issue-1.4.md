## Issue 1.4: Configure Redis for Caching

### Context
Set up Redis for caching and notification queue management to improve performance and enable real-time features.

### Implementation Steps
1. Add Redis to docker-compose
2. Install Python Redis client
3. Create Redis config and connection manager
4. Implement caching utilities (get_cached, set_cached, invalidate_cache)
5. Add Redis health check

### Acceptance Criteria
- Redis starts with docker-compose
- Python Redis client connects successfully
- Cache utilities work correctly
- Redis connection is included in health check

### Testing Methods
Manual: `docker-compose up -d redis` and `redis-cli ping`
