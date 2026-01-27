const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// Create Redis connection
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create queues
const highPriorityQueue = new Queue('high_priority', { connection });
const defaultQueue = new Queue('default', { connection });

module.exports = {
  highPriorityQueue,
  defaultQueue,
  connection,
};