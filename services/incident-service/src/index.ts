import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { PrismaClient } from '@prisma/client';
import { Kafka } from 'kafkajs';
import path from 'path';

const prisma = new PrismaClient();

const kafka = new Kafka({
  clientId: 'incident-service',
  brokers: [process.env.KAFKA_BROKER || 'kafka:29092'],
});

const producer = kafka.producer();

const PROTO_PATH = path.resolve(__dirname, '../../../shared/proto/incident.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const incidentProto = (grpc.loadPackageDefinition(packageDefinition) as any).incident;

function mapTeamToResponse(team: any) {
  if (!team) return null;
  return {
    id: team.id,
    name: team.name,
    type: team.type,
    leaderName: team.leaderName,
    phone: team.phone,
    status: team.status,
    latitude: team.latitude || 0.0,
    longitude: team.longitude || 0.0,
    createdAt: team.createdAt ? team.createdAt.toISOString() : '',
  };
}

function mapIncidentToResponse(incident: any) {
  return {
    id: incident.id,
    title: incident.title,
    description: incident.description || '',
    location: incident.location,
    severity: incident.severity,
    status: incident.status,
    latitude: incident.latitude || 0.0,
    longitude: incident.longitude || 0.0,
    teamId: incident.teamId || '',
    team: mapTeamToResponse(incident.team),
    audioData: incident.audioData || '',
    reportedAt: incident.reportedAt ? incident.reportedAt.toISOString() : '',
    routedAt: incident.routedAt ? incident.routedAt.toISOString() : '',
    reachedSceneAt: incident.reachedSceneAt ? incident.reachedSceneAt.toISOString() : '',
    containedAt: incident.containedAt ? incident.containedAt.toISOString() : '',
    resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : '',
    createdAt: incident.createdAt ? incident.createdAt.toISOString() : '',
  };
}

const server = new grpc.Server();

server.addService(incidentProto.IncidentService.service, {
  ReportIncident: async (call: any, callback: any) => {
    try {
      const { title, description, location, severity, latitude, longitude, audioData } = call.request;
      const incident = await prisma.incident.create({
        data: {
          title,
          description,
          location,
          severity: severity || 'HIGH',
          status: 'REPORTED',
          latitude: latitude || 13.255,
          longitude: longitude || 76.478,
          audioData: audioData || '',
          reportedAt: new Date(),
        },
        include: { team: true },
      });

      try {
        await producer.send({
          topic: 'incident-created',
          messages: [{ value: JSON.stringify(incident) }],
        });
      } catch (kafkaErr: any) {
        console.warn('[Incident Service] Kafka publish failed (incident-created):', kafkaErr?.message || kafkaErr);
      }

      callback(null, mapIncidentToResponse(incident));
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  GetIncidents: async (_: any, callback: any) => {
    try {
      const incidents = await prisma.incident.findMany({
        orderBy: { createdAt: 'desc' },
        include: { team: true },
      });
      callback(null, { incidents: incidents.map(mapIncidentToResponse) });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  UpdateIncidentStatus: async (call: any, callback: any) => {
    try {
      const { id, status } = call.request;
      const updateData: any = { status };
      const now = new Date();

      if (status === 'IN_ROUTING') updateData.routedAt = now;
      if (status === 'REACHED_SCENE') updateData.reachedSceneAt = now;
      if (status === 'CONTAINED') updateData.containedAt = now;
      if (status === 'RESOLVED') updateData.resolvedAt = now;

      const incident = await prisma.incident.update({
        where: { id },
        data: updateData,
        include: { team: true },
      });

      if (status === 'RESOLVED' && incident.teamId) {
        await prisma.team.update({
          where: { id: incident.teamId },
          data: { status: 'AVAILABLE' },
        });
      }

      try {
        await producer.send({
          topic: 'incident-status-updated',
          messages: [{ value: JSON.stringify(incident) }],
        });
      } catch (kafkaErr: any) {
        console.warn('[Incident Service] Kafka publish failed (incident-status-updated):', kafkaErr?.message || kafkaErr);
      }

      callback(null, mapIncidentToResponse(incident));
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  CreateTeam: async (call: any, callback: any) => {
    try {
      const { name, type, leaderName, phone, latitude, longitude } = call.request;
      const team = await prisma.team.create({
        data: {
          name,
          type: type || 'WATER_TENDER',
          leaderName,
          phone,
          status: 'AVAILABLE',
          latitude: latitude || 13.255,
          longitude: longitude || 76.478,
        },
      });
      callback(null, mapTeamToResponse(team));
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  UpdateTeam: async (call: any, callback: any) => {
    try {
      const { id, name, type, leaderName, phone, status } = call.request;
      const team = await prisma.team.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(type && { type }),
          ...(leaderName && { leaderName }),
          ...(phone && { phone }),
          ...(status && { status }),
        },
      });
      callback(null, mapTeamToResponse(team));
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  DeleteTeam: async (call: any, callback: any) => {
    try {
      const { id } = call.request;
      await prisma.incident.updateMany({
        where: { teamId: id },
        data: { teamId: null },
      });
      await prisma.team.delete({
        where: { id },
      });
      callback(null, { success: true, id });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  GetTeams: async (_: any, callback: any) => {
    try {
      const teams = await prisma.team.findMany({
        include: {
          incidents: {
            where: { status: { not: 'RESOLVED' } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const sanitizedTeams = await Promise.all(
        teams.map(async (team) => {
          if (team.incidents.length === 0 && team.status !== 'AVAILABLE') {
            return await prisma.team.update({
              where: { id: team.id },
              data: { status: 'AVAILABLE' },
            });
          }
          return team;
        })
      );

      callback(null, { teams: sanitizedTeams.map(mapTeamToResponse) });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  UpdateTeamStatus: async (call: any, callback: any) => {
    try {
      const { id, status, latitude, longitude } = call.request;
      const updateData: any = { status };
      if (latitude) updateData.latitude = latitude;
      if (longitude) updateData.longitude = longitude;

      const team = await prisma.team.update({
        where: { id },
        data: updateData,
      });

      callback(null, mapTeamToResponse(team));
    } catch (err: any) {
      if (err.code === 'P2025') {
        callback({ code: grpc.status.NOT_FOUND, message: 'Team not found' });
        return;
      }
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  AssignTeam: async (call: any, callback: any) => {
    try {
      const { incidentId, teamId } = call.request;
      const incident = await prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          select: { id: true },
        });
        if (!team) return null;

        await tx.team.update({
          where: { id: teamId },
          data: { status: 'DISPATCHED' },
        });

        return tx.incident.update({
          where: { id: incidentId },
          data: {
            teamId,
            status: 'IN_ROUTING',
            routedAt: new Date(),
          },
          include: { team: true },
        });
      });

      if (!incident) {
        callback({ code: grpc.status.NOT_FOUND, message: 'Team not found' });
        return;
      }

      try {
        await producer.send({
          topic: 'incident-status-updated',
          messages: [{ value: JSON.stringify(incident) }],
        });
      } catch (kafkaErr: any) {
        console.warn('[Incident Service] Kafka publish failed (assign-team):', kafkaErr?.message || kafkaErr);
      }

      callback(null, mapIncidentToResponse(incident));
    } catch (err: any) {
      if (err.code === 'P2003') {
        callback({ code: grpc.status.NOT_FOUND, message: 'Team no longer exists' });
        return;
      }
      if (err.code === 'P2025') {
        callback({ code: grpc.status.NOT_FOUND, message: 'Incident or team not found' });
        return;
      }
      if (err.code === 'P1001' || err.code === 'P1002' || err.code === 'P1008') {
        callback({ code: grpc.status.UNAVAILABLE, message: 'Database is temporarily unavailable' });
        return;
      }
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },

  ClearResolvedIncidents: async (_: any, callback: any) => {
    try {
      const deleted = await prisma.incident.deleteMany({
        where: { status: 'RESOLVED' },
      });
      callback(null, { success: true, count: deleted.count });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },
});

async function seedDefaultTeams() {
  try {
    const count = await prisma.team.count();
    if (count === 0) {
      console.log('[Incident Service] No squads found in DB. Seeding default teams...');
      await prisma.team.createMany({
        data: [
          {
            name: 'Squad Alpha (Engine 1)',
            type: 'WATER_TENDER',
            leaderName: 'Capt. R. Sharma',
            phone: '+91 98765 43210',
            status: 'AVAILABLE',
            latitude: 13.2554,
            longitude: 76.4782,
          },
          {
            name: 'Squad Bravo (QRV 2)',
            type: 'QUICK_RESPONSE',
            leaderName: 'Lt. Suresh Kumar',
            phone: '+91 91234 56789',
            status: 'AVAILABLE',
            latitude: 13.2580,
            longitude: 76.4810,
          },
          {
            name: 'Squad Charlie (Rescue)',
            type: 'RESCUE_SQUAD',
            leaderName: 'Chief Ananya',
            phone: '+91 99887 76655',
            status: 'AVAILABLE',
            latitude: 13.2520,
            longitude: 76.4740,
          },
        ],
      });
      console.log('[Incident Service] Default squads successfully seeded into database!');
    }
  } catch (err) {
    console.error('[Incident Service] Error seeding teams:', err);
  }
}

async function main() {
  try {
    await producer.connect();
    console.log('[Incident Service] Kafka Producer connected.');
  } catch (err: any) {
    console.warn('[Incident Service] Kafka broker not available. Proceeding without Kafka:', err?.message || err);
  }

  await seedDefaultTeams();

  const PORT = process.env.PORT || '50051';
  server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error('[Incident Service] Failed to bind:', err);
      return;
    }
    console.log(`[Incident Service] gRPC running on port ${PORT}`);
  });
}

main().catch(console.error);