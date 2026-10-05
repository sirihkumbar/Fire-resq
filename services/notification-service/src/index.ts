import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const kafka = new Kafka({
  clientId: 'notification-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const consumer = kafka.consumer({ groupId: 'fire-resq-notification-group' });

async function runNotificationService() {
  await consumer.connect();
  console.log('[Notification Service] Connected to Kafka broker on port 9092');

  // Subscribe to both topics
  await consumer.subscribe({ topic: 'incident-created', fromBeginning: false });
  await consumer.subscribe({ topic: 'incident-status-updated', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      if (!message.value) return;

      const incident = JSON.parse(message.value.toString());

      console.log('----------------------------------------------------');
      if (topic === 'incident-created') {
        console.log(`[ALERT: NEW INCIDENT] Topic: ${topic}`);
        console.log(`ID       : ${incident.id}`);
        console.log(`Title    : ${incident.title}`);
        console.log(`Location : ${incident.location}`);
        console.log(`Severity : ${incident.severity}`);
        console.log('Action   : Broadcasting dispatch alert to nearest units...');
      } else if (topic === 'incident-status-updated') {
        console.log(`[UPDATE: STATUS CHANGE] Topic: ${topic}`);
        console.log(`ID        : ${incident.id}`);
        console.log(`Title     : ${incident.title}`);
        console.log(`New Status: ${incident.status}`);
        console.log('Action    : Updating responder units and dispatch log...');
      }
      console.log('----------------------------------------------------');
    },
  });
}

runNotificationService().catch((err) => {
  console.error('[Notification Service] Error:', err);
  process.exit(1);
});