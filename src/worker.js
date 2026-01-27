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
// High priority queue worker
const highPriorityWorker = new Worker('high_priority', processJob, {
  connection,
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  },
  settings: {
    backoffStrategy: (attemptsMade) => {
      // Exponential backoff: 1s, 2s, 4s
      return Math.min(Math.pow(2, attemptsMade) * 1000, 10000);
    },
  },
  autorun: false,
});

// Default queue worker
const defaultWorker = new Worker('default', processJob, {
  connection,
  concurrency: 3,
  limiter: {
    max: 5,
    duration: 1000,
  },
  settings: {
    backoffStrategy: (attemptsMade) => {
      return Math.min(Math.pow(2, attemptsMade) * 1000, 10000);
    },
  },
  autorun: false,
});

// Worker event handlers
highPriorityWorker.on('completed', (job) => {
  console.log(`[High Priority] Job ${job.data.jobId} completed`);
});

highPriorityWorker.on('failed', (job, err) => {
  console.log(`[High Priority] Job ${job?.data?.jobId} failed: ${err.message}`);
});

defaultWorker.on('completed', (job) => {
  console.log(`[Default] Job ${job.data.jobId} completed`);
});

defaultWorker.on('failed', (job, err) => {
  console.log(`[Default] Job ${job?.data?.jobId} failed: ${err.message}`);
});

// Configure retry settings
const retryConfig = {
  attempts: MAX_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
};

// Apply retry config by overriding the default job options
highPriorityWorker.opts = { ...highPriorityWorker.opts, ...retryConfig };
defaultWorker.opts = { ...defaultWorker.opts, ...retryConfig };

// Start workers
async function startWorkers() {
  console.log('Starting workers...');
  
  // Start high priority worker first to ensure it processes first
  await highPriorityWorker.run();
  await defaultWorker.run();
  
  console.log('Workers started successfully');
  console.log('- High priority queue: listening');
  console.log('- Default queue: listening');
}

startWorkers().catch((error) => {
  console.error('Failed to start workers:', error);
  process.exit(1);
});

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