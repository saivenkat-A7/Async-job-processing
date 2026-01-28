require('dotenv').config();
const { Worker } = require('bullmq');
const db = require('./db');
const { connection } = require('./queue');
const { processCSVExport, processEmailSend } = require('./processors');

const MAX_ATTEMPTS = 3;

// Job processor function
async function processJob(job) {
  const { jobId, type, payload } = job.data;

  console.log(`[Worker] Processing job ${jobId} (type: ${type}, attempt: ${job.attemptsMade + 1}/${MAX_ATTEMPTS})`);

  try {
    // Update job status to processing
    await db.query(
      `UPDATE jobs 
       SET status = 'processing', 
           attempts = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [job.attemptsMade + 1, jobId]
    );

    let result;

    // Process based on job type
    switch (type) {
      case 'CSV_EXPORT':
        result = await processCSVExport(job);
        break;
      case 'EMAIL_SEND':
        result = await processEmailSend(job);
        break;
      default:
        throw new Error(`Unknown job type: ${type}`);
    }

    // Update job status to completed
    await db.query(
      `UPDATE jobs 
       SET status = 'completed', 
           result = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(result), jobId]
    );

    console.log(`[Worker] Job ${jobId} completed successfully`);
    return result;
  } catch (error) {
    console.error(`[Worker] Job ${jobId} failed:`, error.message);

    // Check if we've exhausted all attempts
    const currentAttempt = job.attemptsMade + 1;
    
    if (currentAttempt >= MAX_ATTEMPTS) {
      // Mark as permanently failed
      await db.query(
        `UPDATE jobs 
         SET status = 'failed', 
             error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error.message, jobId]
      );
      console.log(`[Worker] Job ${jobId} permanently failed after ${MAX_ATTEMPTS} attempts`);
    } else {
      // Update attempts count but keep status for retry
      await db.query(
        `UPDATE jobs 
         SET attempts = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [currentAttempt, jobId]
      );
      console.log(`[Worker] Job ${jobId} will be retried (attempt ${currentAttempt}/${MAX_ATTEMPTS})`);
    }

    throw error; // Re-throw to trigger BullMQ retry mechanism
  }
}

// Create workers for both queues
console.log('Initializing workers...');

// High priority queue worker
const highPriorityWorker = new Worker('high_priority', processJob, {
  connection,
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  },
});

// Default queue worker  
const defaultWorker = new Worker('default', processJob, {
  connection,
  concurrency: 3,
  limiter: {
    max: 5,
    duration: 1000,
  },
});

// Worker event handlers
highPriorityWorker.on('ready', () => {
  console.log('[High Priority] Worker ready and listening for jobs');
});

highPriorityWorker.on('completed', (job) => {
  console.log(`[High Priority] Job ${job.data.jobId} completed`);
});

highPriorityWorker.on('failed', (job, err) => {
  console.log(`[High Priority] Job ${job?.data?.jobId} failed: ${err.message}`);
});

highPriorityWorker.on('error', (err) => {
  console.error('[High Priority] Worker error:', err);
});

defaultWorker.on('ready', () => {
  console.log('[Default] Worker ready and listening for jobs');
});

defaultWorker.on('completed', (job) => {
  console.log(`[Default] Job ${job.data.jobId} completed`);
});

defaultWorker.on('failed', (job, err) => {
  console.log(`[Default] Job ${job?.data?.jobId} failed: ${err.message}`);
});

defaultWorker.on('error', (err) => {
  console.error('[Default] Worker error:', err);
});

console.log('Workers initialized successfully');
console.log('- High priority queue: listening');
console.log('- Default queue: listening');

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down workers...');
  
  await highPriorityWorker.close();
  await defaultWorker.close();
  await db.end();
  
  console.log('Workers shut down successfully');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);