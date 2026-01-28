require('dotenv').config();
const express = require('express');
const db = require('./db');
const { highPriorityQueue, defaultQueue } = require('./queue');

const app = express();
const PORT = process.env.API_PORT || 3000;

app.use(express.json());


app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/jobs', async (req, res) => {
  try {
    const { type, priority = 'default', payload } = req.body;

    // Validate input
    if (!type || !payload) {
      return res.status(400).json({ error: 'type and payload are required' });
    }

    
    if (priority !== 'default' && priority !== 'high') {
      return res.status(400).json({ error: 'priority must be "default" or "high"' });
    }

   
    const result = await db.query(
      `INSERT INTO jobs (type, priority, payload, status, attempts)
       VALUES ($1, $2, $3, 'pending', 0)
       RETURNING id`,
      [type, priority, JSON.stringify(payload)]
    );

    const jobId = result.rows[0].id;

   
    const queue = priority === 'high' ? highPriorityQueue : defaultQueue;
    await queue.add(type, {
      jobId,
      type,
      payload,
    }, {
      jobId: jobId,
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    console.log(`[API] Job created: ${jobId} (type: ${type}, priority: ${priority})`);
    res.status(201).json({ jobId });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, type, status, priority, attempts, result, error, created_at, updated_at
       FROM jobs
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];

    res.status(200).json({
      id: job.id,
      type: job.type,
      status: job.status,
      priority: job.priority,
      attempts: job.attempts,
      result: job.result,
      error: job.error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    });
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await db.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing server...');
  await db.end();
  process.exit(0);
});
