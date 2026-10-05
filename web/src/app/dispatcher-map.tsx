'use client';

import { useEffect } from 'react';
import type { DivIcon } from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';

type MapIncident = {
  id: string;
  title: string;
  description?: string | null;
  location: string;
  status: string;
  latitude?: number;
  longitude?: number;
};

type MapTeam = {
  id: string;
  name: string;
  leaderName: string;
  phone: string;
  status: string;
  latitude?: number;
  longitude?: number;
};

export type DispatcherMapProps = {
  center: [number, number];
  incidents: MapIncident[];
  teams: MapTeam[];
  icons: {
    victimIcon: DivIcon;
    teamIcon: DivIcon;
    busyTeamIcon: DivIcon;
  };
  visible: boolean;
};

function ResizeOnShow({ visible }: { visible: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(frame);
  }, [map, visible]);

  return null;
}

export default function DispatcherMap({ center, incidents, teams, icons, visible }: DispatcherMapProps) {
  return (
    <MapContainer
      center={center}
      zoom={14}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
    >
      <ResizeOnShow visible={visible} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {incidents.map((incident) => {
        if (!incident.latitude || !incident.longitude) return null;
        return (
          <Marker
            key={incident.id}
            position={[incident.latitude, incident.longitude]}
            icon={icons.victimIcon}
          >
            <Popup>
              <div className="text-slate-900 font-bold text-xs space-y-1">
                <div className="text-red-600 uppercase font-black tracking-wider">
                  🔥 {incident.title}
                </div>
                <div className="font-normal text-slate-700">{incident.location}</div>
                {incident.description && (
                  <div className="text-[11px] italic bg-slate-100 p-1.5 rounded text-slate-600">
                    "{incident.description}"
                  </div>
                )}
                <div className="font-mono text-[10px] text-slate-500">
                  Status: {incident.status}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {teams.map((team) => {
        if (!team.latitude || !team.longitude) return null;
        const isAvailable = team.status === 'AVAILABLE';
        return (
          <Marker
            key={team.id}
            position={[team.latitude, team.longitude]}
            icon={isAvailable ? icons.teamIcon : icons.busyTeamIcon}
          >
            <Popup>
              <div className="text-slate-900 font-bold text-xs space-y-1">
                <div className="text-emerald-700 font-black">🚒 {team.name}</div>
                <div className="font-normal text-slate-700">Leader: {team.leaderName}</div>
                <div className="font-mono text-slate-800">{team.phone}</div>
                <div className="text-[10px] px-2 py-0.5 rounded bg-slate-200 inline-block">
                  Status: {team.status}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}