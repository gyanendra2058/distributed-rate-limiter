-- Sliding Window Log rate limiter (atomic)
-- KEYS[1] = ratelimit:sw:{userId}:{endpoint}
-- ARGV[1] = max_requests (allowed per window)
-- ARGV[2] = window_size_ms (window duration in milliseconds)
-- ARGV[3] = now (current timestamp in milliseconds)
-- ARGV[4] = request_id (unique identifier for this request)

local key = KEYS[1]
local max_requests = tonumber(ARGV[1])
local window_size_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4]

local window_start = now - window_size_ms

-- Remove expired entries outside the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current requests in window
local current_count = redis.call('ZCARD', key)

if current_count < max_requests then
  -- Add this request to the sorted set (score = timestamp)
  redis.call('ZADD', key, now, request_id)
  redis.call('PEXPIRE', key, window_size_ms)
  return {1, max_requests - current_count - 1, 0}
else
  -- Get the oldest entry to calculate retry-after
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after_ms = 0
  if #oldest > 0 then
    retry_after_ms = tonumber(oldest[2]) + window_size_ms - now
    if retry_after_ms < 0 then retry_after_ms = 0 end
  end
  redis.call('PEXPIRE', key, window_size_ms)
  return {0, 0, retry_after_ms}
end
