'use client';

import { useState, useEffect, useRef } from 'react';
import { gql } from '@apollo/client';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import dynamic from 'next/dynamic';
import { fetchDrivingRoute, hasValidCoordinates } from '../../lib/road-routing';
import {
  Truck,
  MapPin,
  Navigation,
  Radio,
  Flame,
  ShieldCheck,
  Volume2,
  Archive,
  Play,
  Compass,
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const DEFAULT_COORDS: [number, number] = [13.2554, 76.4782];

const MapContainer = dynamic(
  () => import('react-leaflet').then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((mod) => mod.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import('react-leaflet').then((mod) => mod.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import('react-leaflet').then((mod) => mod.Popup),
  { ssr: false }
);
const Tooltip = dynamic(
  () => import('react-leaflet').then((mod) => mod.Tooltip),
  { ssr: false }
);
const Polyline = dynamic(
  () => import('react-leaflet').then((mod) => mod.Polyline),
  { ssr: false }
);

const MapBoundsAdjuster = dynamic(
  () =>
    import('react-leaflet').then((mod) => {
      const { useMap } = mod;
      return function Adjuster({
        truckPos,
        victimPos,
      }: {
        truckPos?: [number, number] | null;
        victimPos?: [number, number] | null;
      }) {
        const map = useMap();
        useEffect(() => {
          if (!map) return;
          if (
            truckPos &&
            victimPos &&
            (victimPos[0] !== truckPos[0] || victimPos[1] !== truckPos[1])
          ) {
            map.fitBounds([truckPos, victimPos], { padding: [50, 50], maxZoom: 16 });
          } else if (truckPos) {
            map.setView(truckPos, 15);
          } else if (victimPos) {
            map.setView(victimPos, 15);
          } else {
            map.setView(DEFAULT_COORDS, 15);
          }
        }, [map, truckPos, victimPos]);
        return null;
      };
    }),
  { ssr: false }
);

function computeDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const GET_RESPONDER_DATA = gql`
  query GetResponderData {
    teams {
      id
      name
      type
      leaderName
      phone
      status
      latitude
      longitude
    }
    incidents {
      id
      title
      description
      location
      severity
      status
      teamId
      latitude
      longitude
      audioData
      reportedAt
      routedAt
      reachedSceneAt
      containedAt
      resolvedAt
      createdAt
    }
  }
`;

const UPDATE_TEAM_STATUS = gql`
  mutation UpdateTeamStatus($id: ID!, $status: String!, $latitude: Float, $longitude: Float) {
    updateTeamStatus(id: $id, status: $status, latitude: $latitude, longitude: $longitude) {
      id
      status
      latitude
      longitude
    }
  }
`;

const UPDATE_INCIDENT_STATUS = gql`
  mutation UpdateIncidentStatus($id: ID!, $status: String!) {
    updateIncidentStatus(id: $id, status: $status) {
      id
      status
      reportedAt
      routedAt
      reachedSceneAt
      containedAt
      resolvedAt
    }
  }
`;

const ON_INCIDENT_STATUS_UPDATED = gql`
  subscription OnIncidentStatusUpdated {
    incidentStatusUpdated {
      id
      status
      teamId
      title
      description
      location
      latitude
      longitude
      audioData
    }
  }
`;

const ON_INCIDENT_CREATED = gql`
  subscription OnIncidentCreated {
    incidentCreated {
      id
      title
      description
      location
      status
      teamId
      audioData
    }
  }
`;

export default function FireTeamResponderApp() {
  const [mounted, setMounted] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [dutyStatus, setDutyStatus] = useState<'AVAILABLE' | 'OFF_DUTY'>('AVAILABLE');
  const dutyStatusRef = useRef<'AVAILABLE' | 'OFF_DUTY'>('AVAILABLE');

  const [viewTab, setViewTab] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');
  const [teamCoords, setTeamCoords] = useState<{ lat: number; lng: number }>({
    lat: DEFAULT_COORDS[0],
    lng: DEFAULT_COORDS[1],
  });
  const [hasLiveGps, setHasLiveGps] = useState(false);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState('');
  const [currentAddress, setCurrentAddress] = useState<string>('Station Base (Waiting for GPS)');
  const [leafletIcons, setLeafletIcons] = useState<{ victimIcon: any; teamIcon: any } | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const [roadCoordinates, setRoadCoordinates] = useState<[number, number][]>([]);
  const [roadRouteSummary, setRoadRouteSummary] = useState<{
    distanceKm: number;
    etaMinutes: number;
    locationSource: 'live GPS' | 'last saved location';
  } | null>(null);
  const [routeInstructions, setRouteInstructions] = useState<string[]>([]);
  const navigationMapRef = useRef<HTMLDivElement | null>(null);
  const announcedIncidentIdRef = useRef<string | null>(null);
  const lastBroadcastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    dutyStatusRef.current = dutyStatus;
  }, [dutyStatus]);

  useEffect(() => {
    try {
      const savedId = localStorage.getItem('fireresq_responder_team_id');
      if (savedId) setSelectedTeamId(savedId);

      const savedDuty = localStorage.getItem('fireresq_responder_duty_status') as any;
      if (savedDuty === 'OFF_DUTY' || savedDuty === 'AVAILABLE') {
        setDutyStatus(savedDuty);
        dutyStatusRef.current = savedDuty;
      }
    } catch {}
  }, []);

  const { data, refetch, client, loading: loadingResponderData } = useQuery<{
    teams: any[];
    incidents: any[];
  }>(GET_RESPONDER_DATA, {
    pollInterval: 1500,
    fetchPolicy: 'network-only',
  });

  const [updateTeamStatus, { loading: togglingDuty }] = useMutation(UPDATE_TEAM_STATUS);
  const [updateIncidentStatus] = useMutation(UPDATE_INCIDENT_STATUS);

  const teams = data?.teams || [];
  const incidents = data?.incidents || [];
  const activeTeam = teams.find((t: any) => t.id === selectedTeamId);
  const hasSavedTeamCoords = hasValidCoordinates(activeTeam?.latitude, activeTeam?.longitude);
  const hasSquadCoords = hasLiveGps || hasSavedTeamCoords;
  const squadCoords = hasLiveGps || !hasSavedTeamCoords
    ? teamCoords
    : { lat: activeTeam.latitude, lng: activeTeam.longitude };

  useEffect(() => {
    if (loadingResponderData || !data?.teams || !selectedTeamId) return;

    const teamExists = data.teams.some((t: any) => t.id === selectedTeamId);
    if (!teamExists && data.teams.length > 0) {
      setSelectedTeamId('');
      try {
        localStorage.removeItem('fireresq_responder_team_id');
      } catch {}
    }
  }, [data, loadingResponderData, selectedTeamId]);

  const playChimeAndSpeak = (text: string, urgent = false) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(urgent ? 0.8 : 0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (urgent ? 0.55 : 0.3));

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (urgent ? 0.55 : 0.3));
    } catch {}

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = urgent ? 0.92 : 1.05;
      utterance.pitch = urgent ? 1 : 1.1;
      utterance.volume = 1;
      utterance.lang = 'en-IN';
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleSelectTeam = (id: string) => {
    setSelectedTeamId(id);
    try {
      localStorage.setItem('fireresq_responder_team_id', id);
    } catch {}

    const team = teams.find((t: any) => t.id === id);
    if (team) {
      const st = team.status === 'OFF_DUTY' ? 'OFF_DUTY' : 'AVAILABLE';
      setDutyStatus(st);
      dutyStatusRef.current = st;
      try {
        localStorage.setItem('fireresq_responder_duty_status', st);
      } catch {}
      playChimeAndSpeak(`Unit ${team.name} terminal connected and ready.`);
    }
  };

  // Create Leaflet Icons
  useEffect(() => {
    (async () => {
      const L = await import('leaflet');

      const victimIcon = L.divIcon({
        className: 'victim-pin',
        html: `
          <div style="
            background: #ef4444;
            border: 3px solid #ffffff;
            border-radius: 50%;
            width: 42px;
            height: 42px;
            box-shadow: 0 0 20px rgba(239, 68, 68, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
          ">
            🔥
          </div>
        `,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });

      const teamIcon = L.divIcon({
        className: 'team-pin',
        html: `
          <div style="
            background: #10b981;
            border: 3px solid #ffffff;
            border-radius: 50%;
            width: 46px;
            height: 46px;
            box-shadow: 0 0 22px rgba(16, 185, 129, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
          ">
            🚒
          </div>
        `,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });

      setLeafletIcons({ victimIcon, teamIcon });
    })();
  }, []);

  const activeMission = incidents.find(
    (inc: any) => inc.teamId === selectedTeamId && inc.status !== 'RESOLVED'
  );

  const squadHistory = incidents.filter(
    (inc: any) => inc.teamId === selectedTeamId && inc.status === 'RESOLVED'
  );

  const currentIncidentStatus = optimisticStatus || activeMission?.status || 'REPORTED';

  // Live GPS Tracking & Database Updates
  useEffect(() => {
    if (!window.isSecureContext || !('geolocation' in navigator)) return;

    const handleLocationError = (error: GeolocationPositionError) => {
      setHasLiveGps(false);
      setGpsError(
        error.code === error.PERMISSION_DENIED
          ? 'Location permission is denied. Allow location access for this site in phone settings.'
          : error.code === error.TIMEOUT
            ? 'Phone GPS timed out. Move outdoors or enable precise location and retry.'
            : 'Phone could not determine a location. Check device location services and retry.'
      );
    };

    const handlePosition = async (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setTeamCoords({ lat, lng });
      setHasLiveGps(true);
      setGpsAccuracyMeters(pos.coords.accuracy);
      setGpsError('');

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`
        );
        const resData = await res.json();
        if (resData?.display_name) {
          const parts = resData.display_name.split(',').map((p: string) => p.trim());
          setCurrentAddress(parts.slice(0, 3).join(', '));
        } else {
          setCurrentAddress(`Squad Spot: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        }
      } catch {
        setCurrentAddress(`Squad Spot: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }

      const last = lastBroadcastCoordsRef.current;
      const movedDist = last ? computeDistanceKm(last.lat, last.lng, lat, lng) : 999;

      if (selectedTeamId && movedDist > 0.003) {
        lastBroadcastCoordsRef.current = { lat, lng };
        const effectiveStatus = activeMission ? 'DISPATCHED' : dutyStatusRef.current;

        updateTeamStatus({
          variables: {
            id: selectedTeamId,
            status: effectiveStatus,
            latitude: lat,
            longitude: lng,
          },
        }).catch(() => {});
      }
    };

    navigator.geolocation.getCurrentPosition(handlePosition, handleLocationError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    });

    const watchId = navigator.geolocation.watchPosition(handlePosition, handleLocationError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, [selectedTeamId, activeMission?.id, updateTeamStatus]);

  useSubscription(ON_INCIDENT_STATUS_UPDATED, {
    onData: () => {
      setOptimisticStatus(null);
      refetch();
    },
  });

  useSubscription(ON_INCIDENT_CREATED, {
    onData: (subscriptionResult) => {
      const createdIncident = (
        subscriptionResult.data as { incidentCreated?: { id: string } | null } | undefined
      )?.incidentCreated;
      if (createdIncident?.id && announcedIncidentIdRef.current !== createdIncident.id) {
        announcedIncidentIdRef.current = createdIncident.id;
        playChimeAndSpeak('A fire incident has been reported. Get ready.', true);
      }
      refetch();
    },
  });

  // Calculate Turn-by-Turn Road Route via OSRM
  useEffect(() => {
    if (!hasValidCoordinates(activeMission?.latitude, activeMission?.longitude)) {
      setRoadCoordinates([]);
      setRoadRouteSummary(null);
      setRouteInstructions(['Destination coordinates are unavailable for turn-by-turn directions.']);
      return;
    }

    if (!hasSquadCoords) {
      setRoadCoordinates([]);
      setRoadRouteSummary(null);
      setRouteInstructions(['Allow device location access to show the squad truck, route, and driving ETA.']);
      return;
    }

    const origin: [number, number] = [squadCoords.lat, squadCoords.lng];
    const destination: [number, number] = [activeMission.latitude, activeMission.longitude];
    const dist = computeDistanceKm(...origin, ...destination);
    if (dist < 0.015 && hasLiveGps) {
      setRoadCoordinates([]);
      setRoadRouteSummary({ distanceKm: dist, etaMinutes: 0, locationSource: 'live GPS' });
      setRouteInstructions(['You are at the destination. Follow the fire marker on the map.']);
      return;
    }

    setRoadRouteSummary(null);
    setRouteInstructions(['Calculating the driving route…']);
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const route = await fetchDrivingRoute(origin, destination, controller.signal);
        setRoadCoordinates(route.coordinates);
        setRoadRouteSummary({
          distanceKm: route.distanceKm,
          etaMinutes: route.durationMinutes,
          locationSource: hasLiveGps ? 'live GPS' : 'last saved location',
        });
        setRouteInstructions(
          route.instructions.length > 0
            ? route.instructions
            : ['Follow the highlighted driving route to the fire marker.']
        );
      } catch {
        if (controller.signal.aborted) return;
        setRoadCoordinates([]);
        setRoadRouteSummary(null);
        setRouteInstructions(['Driving route unavailable. Check the destination coordinates and network connection.']);
      }
    }, 750);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeMission?.id, activeMission?.latitude, activeMission?.longitude, hasSquadCoords, hasLiveGps, squadCoords.lat, squadCoords.lng]);

  const handleStageAdvance = (nextStatus: string) => {
    if (!activeMission) return;

    setOptimisticStatus(nextStatus);

    if (nextStatus === 'IN_ROUTING') {
      playChimeAndSpeak('En route. Navigation initiated.');
    } else if (nextStatus === 'REACHED_SCENE') {
      playChimeAndSpeak('You have reached the scene.');
    } else if (nextStatus === 'CONTAINED') {
      playChimeAndSpeak('Fire is now contained.');
    } else if (nextStatus === 'RESOLVED') {
      playChimeAndSpeak('Mission resolved successfully. Unit available for next call.');
      setDutyStatus('AVAILABLE');
      dutyStatusRef.current = 'AVAILABLE';
      try {
        localStorage.setItem('fireresq_responder_duty_status', 'AVAILABLE');
      } catch {}
    }

    updateIncidentStatus({
      variables: {
        id: activeMission.id,
        status: nextStatus,
      },
    }).then(() => {
      if (nextStatus === 'RESOLVED') {
        updateTeamStatus({
          variables: {
            id: selectedTeamId,
            status: 'AVAILABLE',
            latitude: squadCoords.lat,
            longitude: squadCoords.lng,
          },
        }).catch(() => {});
      }
      refetch();
    });
  };

  const handleGoNavigation = () => {
    if (!activeMission) return;
    handleStageAdvance('IN_ROUTING');
    navigationMapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const playVictimAudio = (audioData?: string | null, incidentId?: string) => {
    if (!audioData) {
      alert('No recorded voice audio attached with this incident.');
      return;
    }
    try {
      const audio = new Audio(audioData);
      setPlayingAudioId(incidentId || null);
      audio.play();
      audio.onended = () => setPlayingAudioId(null);
      audio.onerror = () => setPlayingAudioId(null);
    } catch {
      setPlayingAudioId(null);
    }
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '--:--:--';
    try {
      return new Date(isoString).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return '--:--:--';
    }
  };

  const isOnDuty = dutyStatus === 'AVAILABLE';

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 max-w-xl mx-auto flex flex-col justify-between font-sans">
      <header className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-600/20 border border-emerald-500/40 rounded-xl text-emerald-400">
            <Truck className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">FireResQ Squad Terminal</h1>
            <p className="text-xs text-slate-400">Field Responder Unit</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full font-bold">
          <Radio className="w-3 h-3 animate-pulse" />
          <span>{hasLiveGps ? 'GPS LIVE' : 'GPS WAITING'}</span>
        </div>
      </header>

      {/* Squad Duty Status Card */}
      <div className="mt-4 bg-slate-900 border-2 border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-xl">
        <div className="space-y-0.5">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Squad Duty Status
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                !selectedTeamId
                  ? 'bg-slate-600'
                  : isOnDuty
                  ? 'bg-emerald-400 animate-ping'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-sm font-extrabold text-white tracking-wide">
              {!selectedTeamId
                ? 'SELECT SQUAD FIRST'
                : isOnDuty
                ? 'ON DUTY (AVAILABLE)'
                : 'OFF DUTY (UNAVAILABLE)'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!selectedTeamId || !activeTeam || togglingDuty || !!activeMission) return;
            const nextStatus = dutyStatus === 'OFF_DUTY' ? 'AVAILABLE' : 'OFF_DUTY';
            setDutyStatus(nextStatus);
            dutyStatusRef.current = nextStatus;
            try {
              localStorage.setItem('fireresq_responder_duty_status', nextStatus);
            } catch {}
            updateTeamStatus({
              variables: {
                id: selectedTeamId,
                status: nextStatus,
                latitude: squadCoords.lat,
                longitude: squadCoords.lng,
              },
            }).catch(() => {});
          }}
          disabled={!selectedTeamId || !activeTeam || togglingDuty || !!activeMission}
          className={`relative inline-flex h-8 w-16 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 ${
            isOnDuty ? 'bg-emerald-600' : 'bg-slate-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
              isOnDuty ? 'translate-x-8' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Squad Dropdown and Locked GPS Spot */}
      <div className="mt-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3 shadow-lg">
        <div>
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Active Squad Profile
          </label>
          <select
            value={selectedTeamId}
            onChange={(e) => handleSelectTeam(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-emerald-500 cursor-pointer font-medium"
          >
            <option value="">
              {loadingResponderData ? '-- Loading Squads... --' : '-- Choose Your Squad --'}
            </option>
            {teams.map((team: any) => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.leaderName}) • [{team.status === 'OFF_DUTY' ? 'OFF DUTY' : 'ON DUTY'}]
              </option>
            ))}
          </select>
        </div>

        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs flex items-start gap-2">
          <MapPin className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block">
              Hardware GPS Locked Location
            </span>
            <p className="text-slate-200 font-medium leading-snug">{currentAddress}</p>
            <span className="text-[10px] font-mono text-emerald-400/80 block mt-0.5">
              {squadCoords.lat.toFixed(5)}, {squadCoords.lng.toFixed(5)}
            </span>
            {hasLiveGps && gpsAccuracyMeters != null && (
              <span className="text-[10px] text-slate-400 block mt-1">
                Live GPS accuracy ±{Math.round(gpsAccuracyMeters)} m
              </span>
            )}
            {!hasLiveGps && (
              <span className="text-[10px] text-amber-300 block mt-1">
                {!mounted
                  ? 'Checking phone location...'
                  : !window.isSecureContext
                    ? 'Live phone GPS is blocked on HTTP. Open this responder page over HTTPS and allow location access.'
                    : gpsError || (hasSavedTeamCoords
                      ? 'Live GPS is unavailable. The map is showing the squad’s last saved location.'
                      : 'Waiting for live GPS. Allow precise location access on this phone.')}
              </span>
            )}
          </div>
        </div>
      </div>

      {selectedTeamId && (
        <div className="flex gap-2 my-3">
          <button
            onClick={() => setViewTab('ACTIVE')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl border transition cursor-pointer flex items-center justify-center gap-1.5 ${
              viewTab === 'ACTIVE'
                ? 'bg-red-600 border-red-500 text-white'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            Active Incident {activeMission ? '(1)' : '(0)'}
          </button>
          <button
            onClick={() => setViewTab('HISTORY')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl border transition cursor-pointer flex items-center justify-center gap-1.5 ${
              viewTab === 'HISTORY'
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Archive className="w-3.5 h-3.5" />
            Squad Mission History ({squadHistory.length})
          </button>
        </div>
      )}

      {!selectedTeamId ? (
        <div className="my-auto py-12 text-center text-slate-500 space-y-3">
          <div className="w-16 h-16 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center mx-auto text-slate-600">
            <Truck className="w-8 h-8" />
          </div>
          <p className="text-sm font-medium">Select your squad profile above to start GPS transmission.</p>
        </div>
      ) : viewTab === 'ACTIVE' ? (
        activeMission ? (
          <div className="my-auto py-2 space-y-3">
            <div className="bg-red-600/20 border-2 border-red-500 p-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Flame className="w-7 h-7 text-red-400 animate-bounce" />
                <div>
                  <span className="text-[10px] font-black text-red-300 uppercase tracking-wider block">
                    CASE ASSIGNED • PROCEED TO SCENE
                  </span>
                  <h2 className="text-base font-bold text-white leading-tight">
                    {activeMission.title}
                  </h2>
                </div>
              </div>
              <span className="text-xs bg-red-600 text-white font-extrabold px-3 py-1 rounded-full shadow-lg">
                {currentIncidentStatus}
              </span>
            </div>

            {/* Voice statement audio player */}
            {activeMission.description && (
              <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-400 text-[11px] font-semibold uppercase tracking-wider">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Victim Voice Statement</span>
                  </div>

                  {activeMission.audioData && (
                    <button
                      onClick={() => playVictimAudio(activeMission.audioData, activeMission.id)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-bold transition cursor-pointer bg-amber-500 hover:bg-amber-600 text-black border border-amber-400"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{playingAudioId === activeMission.id ? 'Playing...' : 'Play Audio'}</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-200 italic">"{activeMission.description}"</p>
              </div>
            )}

            {/* Destination & Action */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Destination Landmark
                </span>
                <p className="text-xs text-slate-200 font-medium leading-relaxed mt-0.5">
                  {activeMission.location}
                </p>
                {roadRouteSummary ? (
                  <p className="text-[11px] text-emerald-400 font-mono mt-1">
                    Driving route from {roadRouteSummary.locationSource}: {roadRouteSummary.distanceKm.toFixed(2)} km
                    {' · '}
                    {roadRouteSummary.etaMinutes === 0
                      ? 'At destination'
                      : `about ${roadRouteSummary.etaMinutes} min (traffic not included)`}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400 mt-1">
                    {hasSquadCoords
                      ? 'Calculating driving route and arrival time...'
                      : 'Allow location access to calculate the squad route and arrival time.'}
                  </p>
                )}
              </div>

              {/* PRIMARY 'CLICK TO GO' NAVIGATION BUTTON */}
              <button
                onClick={handleGoNavigation}
                className="w-full py-4 text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 shadow-xl shadow-blue-600/30 transition cursor-pointer active:scale-95 bg-blue-600 hover:bg-blue-500 border border-blue-400"
              >
                <Navigation className="w-5 h-5 animate-pulse" />
                <span>
                  {currentIncidentStatus === 'IN_ROUTING'
                    ? 'RESUME TURN-BY-TURN ROAD NAVIGATION'
                    : 'CLICK TO GO • START NAVIGATION'}
                </span>
              </button>
            </div>

            {/* SQUAD ROAD MAP VIEW */}
            <div
              ref={navigationMapRef}
              className="h-72 w-full rounded-2xl overflow-hidden border border-slate-800 relative z-0 shadow-lg bg-slate-900"
            >
              {mounted && leafletIcons ? (
                <MapContainer
                  center={[
                    hasSquadCoords ? squadCoords.lat : activeMission.latitude,
                    hasSquadCoords ? squadCoords.lng : activeMission.longitude,
                  ]}
                  zoom={14}
                  scrollWheelZoom={false}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  <MapBoundsAdjuster
                    truckPos={[
                      hasSquadCoords ? squadCoords.lat : activeMission.latitude,
                      hasSquadCoords ? squadCoords.lng : activeMission.longitude,
                    ]}
                    victimPos={
                      activeMission.latitude != null && activeMission.longitude != null
                        ? [activeMission.latitude, activeMission.longitude]
                        : null
                    }
                  />

                  {/* Road Route Polyline */}
                  {roadCoordinates.length > 1 && (
                    <Polyline
                      positions={roadCoordinates}
                      color="#2563eb"
                      weight={6}
                      opacity={0.9}
                    />
                  )}

                  {/* Squad Truck Pin */}
                  {hasSquadCoords && (
                    <Marker position={[squadCoords.lat, squadCoords.lng]} icon={leafletIcons.teamIcon}>
                      <Tooltip permanent direction="top" offset={[0, -22]}>
                        <span className="font-bold text-xs text-emerald-800">
                          🚒 Your Truck ({activeTeam?.name})
                        </span>
                      </Tooltip>
                      <Popup autoPan>
                        <div className="p-1 text-slate-900">
                          <div className="font-black text-xs text-emerald-700 uppercase">
                            🚒 {activeTeam?.name}
                          </div>
                          <div className="text-[11px] text-slate-700 mt-0.5">{currentAddress}</div>
                          <div className="text-[10px] font-mono text-slate-500 mt-1">
                            GPS: {squadCoords.lat.toFixed(5)}, {squadCoords.lng.toFixed(5)}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  )}

                  {/* Incident Target Pin */}
                  {activeMission.latitude != null && activeMission.longitude != null && (
                    <Marker
                      position={[activeMission.latitude, activeMission.longitude]}
                      icon={leafletIcons.victimIcon}
                    >
                      <Tooltip permanent direction="top" offset={[0, -20]}>
                        <span className="font-bold text-xs text-red-600">
                          🔥 Target: {activeMission.title}
                        </span>
                      </Tooltip>
                      <Popup autoPan>
                        <div className="p-1 text-slate-900">
                          <div className="font-black text-xs text-red-600 uppercase">
                            🔥 Fire Destination
                          </div>
                          <div className="text-xs font-bold mt-0.5">{activeMission.title}</div>
                          <div className="text-[11px] text-slate-700">{activeMission.location}</div>
                        </div>
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-slate-400 gap-2">
                  <Compass className="w-5 h-5 animate-spin text-emerald-400" />
                  <span>Loading road route map...</span>
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                Turn-by-turn directions
              </h3>
              <ol className="max-h-48 space-y-2 overflow-y-auto text-xs text-slate-200">
                {routeInstructions.map((instruction, index) => (
                  <li key={`${index}-${instruction}`} className="flex gap-2">
                    <span className="font-mono text-emerald-400">{index + 1}.</span>
                    <span>{instruction}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Tactical Stage Progression Buttons */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Tactical Progression (Tap to Update Station Instantly)
              </span>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleStageAdvance('IN_ROUTING')}
                  className={`py-3 px-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-95 border ${
                    currentIncidentStatus === 'IN_ROUTING'
                      ? 'bg-amber-600 border-amber-400 text-white shadow-lg shadow-amber-600/40 ring-2 ring-amber-400'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  1. EN ROUTE
                </button>

                <button
                  onClick={() => handleStageAdvance('REACHED_SCENE')}
                  className={`py-3 px-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-95 border ${
                    currentIncidentStatus === 'REACHED_SCENE'
                      ? 'bg-red-600 border-red-400 text-white shadow-lg shadow-red-600/40 ring-2 ring-red-400'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  2. REACHED SCENE
                </button>

                <button
                  onClick={() => handleStageAdvance('CONTAINED')}
                  className={`py-3 px-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-95 border ${
                    currentIncidentStatus === 'CONTAINED'
                      ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-600/40 ring-2 ring-blue-400'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  3. FIRE CONTAINED
                </button>

                <button
                  onClick={() => handleStageAdvance('RESOLVED')}
                  className="py-3 px-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white border border-emerald-400 cursor-pointer shadow-lg shadow-emerald-600/30"
                >
                  4. RESOLVED / COMPLETE
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="my-auto py-12 text-center space-y-3 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <ShieldCheck className="w-12 h-12 mx-auto text-emerald-400" />
            <h2 className="text-base font-bold text-white">Squad on Standby</h2>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Unit <strong className="text-white">{activeTeam?.name}</strong> is ready ({isOnDuty ? 'ON DUTY' : 'OFF DUTY'}). Hardware GPS is broadcasting live to Station Headquarters.
            </p>
          </div>
        )
      ) : (
        <div className="my-auto py-2 space-y-3">
          <h2 className="text-sm font-bold text-slate-300 flex items-center gap-2">
            <Archive className="w-4 h-4 text-emerald-400" />
            Solved Cases History for {activeTeam?.name}
          </h2>

          {squadHistory.length === 0 ? (
            <div className="p-10 text-center text-slate-500 bg-slate-900 border border-slate-800 rounded-2xl text-xs">
              No completed missions logged for this squad yet.
            </div>
          ) : (
            <div className="space-y-3 max-h-137.5 overflow-y-auto pr-1">
              {squadHistory.map((inc: any) => (
                <div key={inc.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-white text-sm">{inc.title}</h3>
                      <p className="text-xs text-slate-400">{inc.location}</p>
                    </div>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded font-bold">
                      RESOLVED
                    </span>
                  </div>

                  <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-[11px] grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block">Reported:</span>
                      <span className="text-slate-300 font-mono">{formatTime(inc.reportedAt || inc.createdAt)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">En Route:</span>
                      <span className="text-amber-400 font-mono">{formatTime(inc.routedAt)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Reached Scene:</span>
                      <span className="text-red-400 font-mono">{formatTime(inc.reachedSceneAt)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Resolved:</span>
                      <span className="text-emerald-400 font-mono">{formatTime(inc.resolvedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <footer className="pt-4 border-t border-slate-800 text-center text-[11px] text-slate-500">
        FireResQ Tactical Field App • Station Connected
      </footer>
    </div>
  );
}