'use client';

import { Fragment, useEffect } from 'react';
import type { DivIcon } from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';

type TacticalTeam = {
  id: string;
  name: string;
  leaderName: string;
  phone: string;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
};

type TacticalIncident = {
  id: string;
  title: string;
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  team?: TacticalTeam | null;
};

export type TacticalMapProps = {
  teams: TacticalTeam[];
  incidents: TacticalIncident[];
  routes: Record<string, [number, number][]>;
  teamAddresses: Record<string, string>;
  icons: {
    victimIcon: DivIcon;
    availableTeamIcon: DivIcon;
    dispatchedTeamIcon: DivIcon;
    offDutyTeamIcon: DivIcon;
    stationIcon: DivIcon;
  };
  visible: boolean;
};

const STATION_COORDS: [number, number] = [13.2554, 76.4782];

function ResizeOnShow({ visible }: { visible: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(frame);
  }, [map, visible]);

  return null;
}

export default function TacticalMap({ teams, incidents, routes, teamAddresses, icons, visible }: TacticalMapProps) {
  return (
    <MapContainer
      key={visible ? 'tactical-map-visible' : 'tactical-map-hidden'}
      center={STATION_COORDS}
      zoom={14}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
    >
      <ResizeOnShow visible={visible} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Marker position={STATION_COORDS} icon={icons.stationIcon}>
        <Tooltip direction="top" offset={[0, -15]} opacity={1}>
          <div className="font-bold text-xs text-slate-900">
            🏢 Fire Station Headquarters (Tiptur Base)
          </div>
        </Tooltip>
      </Marker>

      {incidents.map((incident) => {
        if (!incident.team?.id) return null;
        const routeCoordinates = routes[incident.id];
        if (!routeCoordinates?.length) return null;

        return (
          <Fragment key={`squad-route-container-${incident.id}`}>
            <Polyline
              positions={routeCoordinates}
              color="#64748b"
              weight={5}
              opacity={0.5}
              dashArray="6, 6"
            />
            <Polyline
              positions={routeCoordinates}
              color="#2563eb"
              weight={6}
              opacity={0.9}
            >
              <Tooltip direction="top" opacity={0.95} sticky>
                <div className="text-xs font-sans text-slate-900 space-y-0.5">
                  <span className="font-bold text-blue-700 block">🚒 {incident.team.name} Route</span>
                  <span>Target: <strong>{incident.location}</strong></span>
                  <span className="text-[10px] text-slate-600 block">
                    Officer: {incident.team.leaderName}
                  </span>
                </div>
              </Tooltip>
            </Polyline>
          </Fragment>
        );
      })}

      {teams.map((team, index) => {
        const baseLat = team.latitude && team.latitude !== 0 ? team.latitude : STATION_COORDS[0];
        const baseLng = team.longitude && team.longitude !== 0 ? team.longitude : STATION_COORDS[1];
        const angle = (index * (2 * Math.PI)) / Math.max(1, teams.length);
        const teamLat = baseLat + Math.sin(angle) * 0.00012;
        const teamLng = baseLng + Math.cos(angle) * 0.00012;
        const isAvailable = team.status === 'AVAILABLE';
        const isOffDuty = team.status === 'OFF_DUTY';
        const standName = teamAddresses[team.id] || 'At Station Base / Locating...';
        const pinIcon = isOffDuty
          ? icons.offDutyTeamIcon
          : isAvailable
          ? icons.availableTeamIcon
          : icons.dispatchedTeamIcon;

        return (
          <Marker key={team.id} position={[teamLat, teamLng]} icon={pinIcon}>
            <Tooltip direction="top" offset={[0, -20]} opacity={0.95}>
              <div className="font-sans text-xs space-y-1 text-slate-900 max-w-[220px]">
                <div className="font-bold text-sm flex items-center gap-1 border-b pb-0.5">
                  <span>{isOffDuty ? '⚪' : '🚒'}</span> {team.name}
                </div>
                <div>👤 Officer: <strong>{team.leaderName}</strong></div>
                <div>📞 <strong>{team.phone}</strong></div>
                <div className="text-[11px] text-slate-700 bg-slate-100 p-1.5 rounded font-normal leading-tight">
                  📍 <strong>Standing at:</strong> {standName}
                </div>
                <div className="text-[10px] uppercase font-bold pt-0.5">
                  Status:{' '}
                  <span
                    className={
                      isOffDuty
                        ? 'text-slate-600 font-black'
                        : isAvailable
                        ? 'text-emerald-700 font-black'
                        : 'text-amber-700 font-black'
                    }
                  >
                    {isAvailable ? 'ON DUTY (READY)' : team.status}
                  </span>
                </div>
              </div>
            </Tooltip>
          </Marker>
        );
      })}

      {incidents.map((incident) => {
        if (!incident.latitude || !incident.longitude) return null;
        return (
          <Marker
            key={incident.id}
            position={[incident.latitude, incident.longitude]}
            icon={icons.victimIcon}
          >
            <Tooltip direction="top" offset={[0, -15]} opacity={1}>
              <div className="font-bold text-xs text-red-700">
                🔥 {incident.title}
                <span className="text-[10px] text-slate-600 block font-normal">
                  {incident.location}
                </span>
              </div>
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}