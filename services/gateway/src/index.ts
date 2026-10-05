import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { PubSub } from 'graphql-subscriptions';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const pubsub = new PubSub();

const INCIDENT_CREATED = 'INCIDENT_CREATED';
const INCIDENT_STATUS_UPDATED = 'INCIDENT_STATUS_UPDATED';
const TEAM_STATUS_UPDATED = 'TEAM_STATUS_UPDATED';

const PROTO_PATH = path.resolve(__dirname, '../../../shared/proto/incident.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const incidentClient = new protoDescriptor.incident.IncidentService(
  process.env.INCIDENT_SERVICE_URL || 'incident-service:50051',
  grpc.credentials.createInsecure()
);

const typeDefs = `#graphql
  type Team {
    id: ID!
    name: String!
    type: String!
    leaderName: String!
    phone: String!
    status: String!
    latitude: Float
    longitude: Float
    createdAt: String
  }

  type Incident {
    id: ID!
    title: String!
    description: String
    location: String!
    severity: String!
    status: String!
    latitude: Float
    longitude: Float
    teamId: String
    team: Team
    audioData: String
    reportedAt: String
    routedAt: String
    reachedSceneAt: String
    containedAt: String
    resolvedAt: String
    createdAt: String
  }

  type Query {
    incidents: [Incident!]!
    teams: [Team!]!
  }

  type Mutation {
    reportIncident(
      title: String!
      description: String
      location: String!
      severity: String!
      latitude: Float
      longitude: Float
      audioData: String
    ): Incident!

    updateIncidentStatus(id: ID!, status: String!): Incident!

    createTeam(
      name: String!
      type: String!
      leaderName: String!
      phone: String!
      latitude: Float
      longitude: Float
    ): Team!

    updateTeam(
      id: ID!
      name: String
      type: String
      leaderName: String
      phone: String
      status: String
    ): Team!

    deleteTeam(id: ID!): Boolean!

    updateTeamStatus(
      id: ID!
      status: String!
      latitude: Float
      longitude: Float
    ): Team!

    assignTeam(incidentId: ID!, teamId: ID!): Incident!

    clearResolvedHistory: Boolean!
  }

  type Subscription {
    incidentCreated: Incident!
    incidentStatusUpdated: Incident!
    teamStatusUpdated: Team!
  }
`;

const resolvers = {
  Query: {
    incidents: async () => {
      return new Promise((resolve, reject) => {
        incidentClient.GetIncidents({}, (err: any, response: any) => {
          if (err) return reject(err);
          resolve(response.incidents || []);
        });
      });
    },
    teams: async () => {
      return new Promise((resolve, reject) => {
        incidentClient.GetTeams({}, (err: any, response: any) => {
          if (err) return reject(err);
          resolve(response.teams || []);
        });
      });
    },
  },

  Mutation: {
    reportIncident: async (_: any, args: any) => {
      return new Promise((resolve, reject) => {
        incidentClient.ReportIncident(args, (err: any, response: any) => {
          if (err) return reject(err);
          pubsub.publish(INCIDENT_CREATED, { incidentCreated: response });
          resolve(response);
        });
      });
    },

    updateIncidentStatus: async (_: any, args: any) => {
      return new Promise((resolve, reject) => {
        incidentClient.UpdateIncidentStatus(args, (err: any, response: any) => {
          if (err) return reject(err);
          pubsub.publish(INCIDENT_STATUS_UPDATED, { incidentStatusUpdated: response });
          resolve(response);
        });
      });
    },

    createTeam: async (_: any, args: any) => {
      return new Promise((resolve, reject) => {
        incidentClient.CreateTeam(args, (err: any, response: any) => {
          if (err) return reject(err);
          pubsub.publish(TEAM_STATUS_UPDATED, { teamStatusUpdated: response });
          resolve(response);
        });
      });
    },

    updateTeam: async (_: any, args: any) => {
      return new Promise((resolve, reject) => {
        incidentClient.UpdateTeam(args, (err: any, response: any) => {
          if (err) return reject(err);
          pubsub.publish(TEAM_STATUS_UPDATED, { teamStatusUpdated: response });
          resolve(response);
        });
      });
    },

    deleteTeam: async (_: any, { id }: { id: string }) => {
      return new Promise((resolve, reject) => {
        incidentClient.DeleteTeam({ id }, (err: any, response: any) => {
          if (err) return reject(err);
          pubsub.publish(TEAM_STATUS_UPDATED, {
            teamStatusUpdated: { id, status: 'DELETED' },
          });
          resolve(response?.success ?? true);
        });
      });
    },

    updateTeamStatus: async (_: any, args: any) => {
      return new Promise((resolve, reject) => {
        incidentClient.UpdateTeamStatus(args, (err: any, response: any) => {
          if (err) return reject(err);
          pubsub.publish(TEAM_STATUS_UPDATED, { teamStatusUpdated: response });
          resolve(response);
        });
      });
    },

    assignTeam: async (_: any, args: any) => {
      return new Promise((resolve, reject) => {
        incidentClient.AssignTeam(args, (err: any, response: any) => {
          if (err) return reject(err);
          pubsub.publish(INCIDENT_STATUS_UPDATED, { incidentStatusUpdated: response });
          if (response.team) {
            pubsub.publish(TEAM_STATUS_UPDATED, { teamStatusUpdated: response.team });
          }
          resolve(response);
        });
      });
    },

    clearResolvedHistory: async () => {
      return new Promise((resolve, reject) => {
        incidentClient.ClearResolvedIncidents({}, (err: any, response: any) => {
          if (err) return reject(err);
          pubsub.publish(INCIDENT_STATUS_UPDATED, {
            incidentStatusUpdated: { id: '__CLEAR__', status: 'CLEARED' },
          });
          resolve(response?.success ?? true);
        });
      });
    },
  },

  Subscription: {
    incidentCreated: {
      subscribe: () => pubsub.asyncIterableIterator([INCIDENT_CREATED]),
    },
    incidentStatusUpdated: {
      subscribe: () => pubsub.asyncIterableIterator([INCIDENT_STATUS_UPDATED]),
    },
    teamStatusUpdated: {
      subscribe: () => pubsub.asyncIterableIterator([TEAM_STATUS_UPDATED]),
    },
  },
};

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });

  const serverCleanup = useServer({ schema }, wsServer);

  const server = new ApolloServer({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await server.start();

  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    express.json({ limit: '20mb' }),
    expressMiddleware(server)
  );

  const PORT = process.env.PORT || 4000;
  httpServer.listen(PORT, () => {
    console.log(`[Gateway] HTTP GraphQL endpoint ready at http://localhost:${PORT}/graphql`);
    console.log(`[Gateway] WebSocket Subscriptions ready at ws://localhost:${PORT}/graphql`);
  });
}

startServer().catch(console.error);