const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');

async function processCSVExport(job) {
  const { jobId, payload } = job.data;
  
  console.log(`[CSV_EXPORT] Processing job ${jobId}`);

  const { data } = payload;

  if (!data || !Array.isArray(data) || data.length === 0) {
    throw new Error('Invalid data: expected non-empty array');
  }

  const headers = Object.keys(data[0]);
  

  let csvContent = headers.join(',') + '\n';
  
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
     
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvContent += values.join(',') + '\n';
  }

  
  const outputDir = '/usr/src/app/output';
  const filename = `${jobId}.csv`;
  const filePath = path.join(outputDir, filename);

  await fs.writeFile(filePath, csvContent, 'utf8');

  console.log(`[CSV_EXPORT] Job ${jobId} completed. File saved to ${filePath}`);

  return {
    filePath: `/usr/src/app/output/${filename}`,
  };
}


async function processEmailSend(job) {
  const { jobId, payload } = job.data;
  
  console.log(`[EMAIL_SEND] Processing job ${jobId}`);

  const { to, subject, body } = payload;

  if (!to || !subject || !body) {
    throw new Error('Invalid payload: to, subject, and body are required');
  }

  // Create SMTP transporter
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'mailhog',
    port: parseInt(process.env.MAIL_PORT || '8025'),
    secure: false,
    ignoreTLS: true,
  });


  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || 'noreply@example.com',
    to,
    subject,
    text: body,
  });

  console.log(`[EMAIL_SEND] Job ${jobId} completed. Message ID: ${info.messageId}`);

  return {
    messageId: info.messageId,
  };
}

module.exports = {
  processCSVExport,
  processEmailSend,
};
