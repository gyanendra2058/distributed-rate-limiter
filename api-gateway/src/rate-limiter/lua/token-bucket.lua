-- Token Bucket rate limiter (atomic check + deduct)
-- KEYS[1] = ratelimit:{userId}:{endpoint}
-- ARGV[1] = max_tokens (bucket capacity)
-- ARGV[2] = refill_rate (tokens per second)
-- ARGV[3] = now (current timestamp in milliseconds)
-- ARGV[4] = tokens_to_consume (typically 1)

local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local tokens_to_consume = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill_ts')
local tokens = tonumber(bucket[1])
local last_refill_ts = tonumber(bucket[2])

if tokens == nil then
  -- First request: initialize bucket
  tokens = max_tokens
  last_refill_ts = now
end

-- Calculate tokens to add based on elapsed time
local elapsed_ms = now - last_refill_ts
local tokens_to_add = (elapsed_ms / 1000.0) * refill_rate
tokens = math.min(max_tokens, tokens + tokens_to_add)
last_refill_ts = now

if tokens >= tokens_to_consume then
  tokens = tokens - tokens_to_consume
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill_ts', last_refill_ts)
  redis.call('EXPIRE', key, math.ceil(max_tokens / refill_rate) + 10)
  return {1, math.floor(tokens), math.ceil((tokens_to_consume / refill_rate) * 1000)}
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill_ts', last_refill_ts)
  redis.call('EXPIRE', key, math.ceil(max_tokens / refill_rate) + 10)
  local retry_after_ms = math.ceil(((tokens_to_consume - tokens) / refill_rate) * 1000)
  return {0, math.floor(tokens), retry_after_ms}
end
