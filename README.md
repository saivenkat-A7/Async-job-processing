# Asynchronous Job Processing System

A scalable backend system for processing long-running tasks asynchronously using Redis, BullMQ, and PostgreSQL. This system demonstrates modern architectural patterns for handling background jobs with features like priority queues, automatic retries, and status tracking.

##  Architecture


The system consists of five main components:

1. **API Service** - Express.js REST API for job creation and status queries
2. **Worker Service** - Background job processor that executes tasks asynchronously
3. **PostgreSQL Database** - Stores job metadata and results
4. **Redis** - Message broker for job queuing
5. **MailHog** - Mock SMTP server for testing email functionality

## Data Flow
### Job Creation Flow
```
1. Client → POST /jobs → API Service
2. API Service → Insert job record → PostgreSQL (status: pending)
3. API Service → Enqueue job → Redis (high_priority or default queue)
4. API Service → Return jobId → Client

```
### Job Processing Flow
```
1. Worker → Poll queue → Redis (check high_priority first, then default)
2. Worker → Update status → PostgreSQL (status: processing)
3. Worker → Process job → Execute CSV_EXPORT or EMAIL_SEND
4. Worker → Store result → PostgreSQL (status: completed, result: {...})
   OR
   Worker → Handle failure → PostgreSQL (status: failed, error: "...")

```
### Job Retry Flow

```
1. Job fails → Worker catches error
2. Worker → Check attempts < 3
3. If attempts < 3:
   - Worker → Increment attempts → PostgreSQL
   - BullMQ → Re-enqueue job with backoff
4. If attempts >= 3:
   - Worker → Update status → PostgreSQL (status: failed)
```


##  Features

-  Asynchronous job processing with BullMQ
-  Priority queues (high and default)
-  Automatic retry mechanism (up to 3 attempts)
-  Job status tracking (pending → processing → completed/failed)
-  CSV report generation
-  Email sending capabilities
-  Fully containerized with Docker
-  Automatic database seeding
-  Health checks for all services
-  Graceful shutdown handling

##  Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Git

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd async-job-system
```

2. Copy the example environment file:
```bash
cp .env.example .env
```

3. Start all services:
```bash
docker-compose up --build
```

All services will start automatically and the database will be seeded with the required schema.

### Verify Installation

1. Check all services are healthy:
```bash
docker-compose ps
```

2. Access the MailHog UI:
```
http://localhost:8025
```

3. Test the API health endpoint:
```bash
curl http://localhost:3000/health
```

##  API Documentation

### Create a Job

**Endpoint:** `POST /jobs`

**Request Body:**
```json
{
  "type": "CSV_EXPORT",
  "priority": "high",
  "payload": {
    "data": [
      {"id": 1, "name": "venkat", "email": "venkat@example.com"},
      {"id": 2, "name": "sai", "email": "sai@example.com"}
    ]
  }
}
```

**Response (201 Created):**
```json
{
  "jobId": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Get Job Status

**Endpoint:** `GET /jobs/:id`

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "type": "CSV_EXPORT",
  "status": "completed",
  "priority": "high",
  "attempts": 1,
  "result": {
    "filePath": "/usr/src/app/output/123e4567-e89b-12d3-a456-426614174000.csv"
  },
  "error": null,
  "createdAt": "2026-01-27T10:30:00.000Z",
  "updatedAt": "2026-01-27T10:30:05.000Z"
}
```

##  Job Types

### 1. CSV Export Job

Generates a CSV file from JSON data.

**Type:** `CSV_EXPORT`

**Payload:**
```json
{
  "data": [
    {"id": 1, "name": "venkat", "email": "venkat@example.com"},
    {"id": 2, "name": "sai", "email": "sai@example.com"}
  ]
}
```

**Result:**
```json
{
  "filePath": "/usr/src/app/output/[jobId].csv"
}
```

The generated CSV file will be available in the `./output` directory on your host machine.

### 2. Email Send Job

Sends an email via the mock SMTP server.

**Type:** `EMAIL_SEND`

**Payload:**
```json
{
  "to": "user@test.com",
  "subject": "Job Notification",
  "body": "Your job has been processed successfully."
}
```

**Result:**
```json
{
  "messageId": "<some-id@example.com>"
}
```

Emails can be viewed in the MailHog UI at `http://localhost:8025`.

##  Job Lifecycle

1. **pending** - Job created and added to queue
2. **processing** - Worker has picked up the job
3. **completed** - Job finished successfully
4. **failed** - Job failed after 3 retry attempts

##  Configuration

All configuration is managed through environment variables. See `.env.example` for available options:

- `API_PORT` - Port for the API service (default: 3000)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `MAIL_HOST` - SMTP host for email sending
- `MAIL_PORT` - SMTP port
- `MAIL_FROM` - Default sender email address

## 🔍 Testing

### Test CSV Export

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CSV_EXPORT",
    "priority": "high",
    "payload": {
      "data": [
        {"id": 1, "name": "venkat", "email": "venkat@example.com"},
        {"id": 2, "name": "sai", "email": "sai@example.com"}
      ]
    }
  }'
```

Check the `./output` directory for the generated CSV file.

### Test Email Sending

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EMAIL_SEND",
    "priority": "default",
    "payload": {
      "to": "test@example.com",
      "subject": "Test Email",
      "body": "This is a test email from the job processing system."
    }
  }'
```

View the email at `http://localhost:8025`.

### Test Priority Queues

```bash
# Create 5 default priority jobs
for i in {1..5}; do
  curl -X POST http://localhost:3000/jobs \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"CSV_EXPORT\",\"priority\":\"default\",\"payload\":{\"data\":[{\"id\":$i}]}}"
done

# Create 1 high priority job
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"CSV_EXPORT","priority":"high","payload":{"data":[{"id":999}]}}'
```

Check worker logs to verify the high priority job is processed first:
```bash
docker-compose logs -f worker
```

### Test Retry Mechanism

Create a job that will fail (invalid payload):
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CSV_EXPORT",
    "priority": "default",
    "payload": {
      "data": "invalid"
    }
  }'
```

Monitor the job status and watch attempts increment up to 3.




### Access Database

```bash
docker-compose exec db psql -U user -d jobs_db

# View all jobs
SELECT * FROM jobs;
```

### Access Redis CLI

```bash
docker-compose exec redis redis-cli

# View queue contents
KEYS *
```




##  Key Features Explained

### Priority Queues

The system uses two separate Redis queues:
- `high_priority` - Processed first
- `default` - Processed after high priority queue is empty

Workers are configured to check high_priority queue before default queue.

### Automatic Retries

Failed jobs are automatically retried up to 3 times with exponential backoff:
- 1st retry: 1 second delay
- 2nd retry: 2 second delay
- 3rd retry: 4 second delay

### Job Status Tracking

Every job state change is persisted to the database:
- Creation time
- Last update time
- Number of attempts
- Current status
- Error messages (if failed)
- Results (if completed)

### Graceful Shutdown

Both API and worker services handle SIGTERM/SIGINT signals:
- Workers complete current jobs before shutting down
- Database connections are properly closed
- No jobs are lost during shutdown

