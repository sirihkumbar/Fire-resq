import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

const client = createClient({
  url: 'ws://localhost:4000/graphql',
  webSocketImpl: WebSocket,
});

console.log('[Test Client] Connecting to ws://localhost:4000/graphql ...');

(async () => {
  const onNext = (data: any) => {
    console.log('\n🔥 [LIVE WEBSOCKET EVENT RECEIVED VIA SUBSCRIPTION]:');
    console.dir(data, { depth: null });
  };

  await new Promise<void>((resolve, reject) => {
    client.subscribe(
      {
        query: `
          subscription {
            incidentStatusUpdated {
              id
              title
              status
            }
          }
        `,
      },
      {
        next: onNext,
        error: reject,
        complete: () => resolve(),
      }
    );
  });
})();