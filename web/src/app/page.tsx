'use client';

import { Fragment, useState, useEffect, useRef } from 'react';
import { gql } from '@apollo/client';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import dynamic from 'next/dynamic';
import type { TacticalMapProps } from './tactical-map';
import { fetchDrivingRoute, hasValidCoordinates } from '../lib/road-routing';
import {
  Flame,
  Radio,
  AlertTriangle,
  Clock,
  MapPin,
  Truck,
  Phone,
  User,
  VolumeX,
  ShieldAlert,
  PlusCircle,
  Users,
  Edit2,
  CheckCircle2,
  X,
  Archive,
  Calendar,
  Trash2,
  Layers,
  Play,
  BellRing,
  Activity,
  CheckCircle,
  Volume2,
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const TacticalMap = dynamic<TacticalMapProps>(
  () => import('./tactical-map'),
  { ssr: false }
);

type Team = {
  id: string;
  name: string;
  type: string;
  leaderName: string;
  phone: string;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
};

type Incident = {
  id: string;
  title: string;
  description?: string | null;
  location: string;
  severity: string;
  status: string;
  teamId?: string | null;
  team?: Team | null;
  latitude?: number | null;
  longitude?: number | null;
  audioData?: string | null;
  reportedAt?: string | null;
  routedAt?: string | null;
  reachedSceneAt?: string | null;
  containedAt?: string | null;
  resolvedAt?: string | null;
  createdAt?: string | null;
};

type IncidentStatusUpdate = {
  id: string;
  status: string;
  teamId?: string | null;
  team?: Team | null;
  reportedAt?: string | null;
  routedAt?: string | null;
  reachedSceneAt?: string | null;
  containedAt?: string | null;
  resolvedAt?: string | null;
};

type TeamStatusUpdate = {
  id: string;
  name?: string | null;
  type?: string | null;
  leaderName?: string | null;
  phone?: string | null;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
};

const STATION_COORDS: [number, number] = [13.2554, 76.4782];

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

// Global Persistent Audio Context
let persistentAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!persistentAudioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      persistentAudioCtx = new AudioContextClass();
    }
  }
  if (persistentAudioCtx && persistentAudioCtx.state === 'suspended') {
    persistentAudioCtx.resume().catch(() => {});
  }
  return persistentAudioCtx;
}

function playStationSiren() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    gain.gain.setValueAtTime(0.25, ctx.currentTime);

    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const start = now + i * 0.8;
      osc.frequency.setValueAtTime(800, start);
      osc.frequency.linearRampToValueAtTime(1250, start + 0.4);
      osc.frequency.linearRampToValueAtTime(800, start + 0.8);
    }

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 2.4);
  } catch (err) {
    console.error('Audio playback error:', err);
  }
}

const GET_INITIAL_DATA = gql`
  query GetInitialData {
    incidents {
      id
      title
      description
      location
      severity
      status
      teamId
      team {
        id
        name
        type
        leaderName
        phone
        status
        latitude
        longitude
      }
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
  }
`;

const CREATE_TEAM = gql`
  mutation CreateTeam(
    $name: String!
    $type: String!
    $leaderName: String!
    $phone: String!
  ) {
    createTeam(
      name: $name
      type: $type
      leaderName: $leaderName
      phone: $phone
    ) {
      id
      name
      type
      leaderName
      phone
      status
      latitude
      longitude
    }
  }
`;

const UPDATE_TEAM = gql`
  mutation UpdateTeam(
    $id: ID!
    $name: String
    $type: String
    $leaderName: String
    $phone: String
    $status: String
  ) {
    updateTeam(
      id: $id
      name: $name
      type: $type
      leaderName: $leaderName
      phone: $phone
      status: $status
    ) {
      id
      name
      type
      leaderName
      phone
      status
    }
  }
`;

const DELETE_TEAM = gql`
  mutation DeleteTeam($id: ID!) {
    deleteTeam(id: $id)
  }
`;

const ASSIGN_TEAM = gql`
  mutation AssignTeam($incidentId: ID!, $teamId: ID!) {
    assignTeam(incidentId: $incidentId, teamId: $teamId) {
      id
      status
      teamId
      team {
        id
        name
        type
        leaderName
        phone
        status
        latitude
        longitude
      }
    }
  }
`;

const CLEAR_RESOLVED_HISTORY = gql`
  mutation ClearResolvedHistory {
    clearResolvedHistory
  }
`;

const ON_INCIDENT_CREATED = gql`
  subscription OnIncidentCreated {
    incidentCreated {
      id
      title
      description
      location
      severity
      status
      teamId
      team {
        id
        name
        type
        leaderName
        phone
        status
        latitude
        longitude
      }
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

const ON_INCIDENT_STATUS_UPDATED = gql`
  subscription OnIncidentStatusUpdated {
    incidentStatusUpdated {
      id
      status
      teamId
      team {
        id
        name
        type
        leaderName
        phone
        status
        latitude
        longitude
      }
      reportedAt
      routedAt
      reachedSceneAt
      containedAt
      resolvedAt
    }
  }
`;

const ON_TEAM_STATUS_UPDATED = gql`
  subscription OnTeamStatusUpdated {
    teamStatusUpdated {
      id
      name
      type
      leaderName
      phone
      status
      latitude
      longitude
    }
  }
`;

const globalGeoCache: Record<string, string> = {};

export default function DispatcherDashboard() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamAddresses, setTeamAddresses] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'RESOLVED' | 'FLEET'>('ACTIVE');
  const [sirenActive, setSirenActive] = useState(false);
  const [audioArmed, setAudioArmed] = useState(false);
  const [latestEmergency, setLatestEmergency] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  // Per-incident squad selection tracking (supports optional assigning)
  const [pendingSquadSelection, setPendingSquadSelection] = useState<Record<string, string>>({});
  const [reassigningIncidentId, setReassigningIncidentId] = useState<string | null>(null);

  const [squadRoadRoutes, setSquadRoadRoutes] = useState<Record<string, [number, number][]>>({});
  const [squadRouteSummaries, setSquadRouteSummaries] = useState<
    Record<string, { distanceKm: number; etaMinutes: number } | null>
  >({});
  const routeKeysRef = useRef<Record<string, string>>({});
  const routeControllersRef = useRef<Record<string, AbortController>>({});

  const [leafletIcons, setLeafletIcons] = useState<{
    victimIcon: any;
    availableTeamIcon: any;
    dispatchedTeamIcon: any;
    offDutyTeamIcon: any;
    stationIcon: any;
  } | null>(null);

  const [isAddTeamModalOpen, setIsAddTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  const sirenIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const previousIncidentCountRef = useRef<number>(0);

  const [teamForm, setTeamForm] = useState({
    name: '',
    type: 'WATER_TENDER',
    leaderName: '',
    phone: '',
  });

  const { data, refetch } = useQuery<{ incidents: Incident[]; teams: Team[] }>(GET_INITIAL_DATA, {
    pollInterval: 1200,
    fetchPolicy: 'cache-and-network',
  });

  const [createTeam, { loading: creatingTeam }] = useMutation<
    { createTeam: Team },
    { name: string; type: string; leaderName: string; phone: string }
  >(CREATE_TEAM);
  const [updateTeam, { loading: updatingTeam }] = useMutation(UPDATE_TEAM);
  const [deleteTeam] = useMutation(DELETE_TEAM);
  const [assignTeam] = useMutation(ASSIGN_TEAM);
  const [clearResolvedHistory, { loading: clearingHistory }] = useMutation(CLEAR_RESOLVED_HISTORY);

  // Request browser desktop notification permission on load
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, []);

  const triggerStationAlert = (incidentTitle: string, incidentLocation: string) => {
    // 1. Desktop push notification
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🚨 CRITICAL FIRE ALARM - FIRERESQ', {
          body: `${incidentTitle}\nLocation: ${incidentLocation}`,
          icon: '/favicon.ico',
        });
      } catch {}
    }

    // 2. Emergency synthetic voice alert
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const speech = new SpeechSynthesisUtterance(`Emergency alert! Fire reported at ${incidentLocation}. Dispatch required.`);
        speech.rate = 1.0;
        speech.lang = 'en-IN';
        window.speechSynthesis.speak(speech);
      } catch {}
    }

    // 3. Siren tone loop
    startSiren();
  };

  const armAudioSystem = () => {
    const ctx = getAudioContext();
    if (ctx) {
      setAudioArmed(true);
      playStationSiren();
    }
  };

  const startSiren = () => {
    stopSiren();
    setSirenActive(true);
    playStationSiren();
    sirenIntervalRef.current = setInterval(() => {
      playStationSiren();
    }, 2500);
  };

  const stopSiren = () => {
    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }
    setSirenActive(false);
  };

  // Detect incoming unassigned incidents
  useEffect(() => {
    if (data?.incidents) {
      const currentUnassigned = data.incidents.filter((i: any) => i.status === 'REPORTED' && !i.teamId).length;
      if (previousIncidentCountRef.current >= 0 && currentUnassigned > previousIncidentCountRef.current) {
        const latest = data.incidents.find((i: any) => i.status === 'REPORTED');
        if (latest) {
          setLatestEmergency(`${latest.title} — ${latest.location}`);
          triggerStationAlert(latest.title, latest.location);
        }
      }
      previousIncidentCountRef.current = currentUnassigned;
      setIncidents(data.incidents);
    }
    if (data?.teams) {
      setTeams(data.teams);
    }
  }, [data]);

  // Turn on audio listener on first interaction
  useEffect(() => {
    const handleGesture = () => {
      const ctx = getAudioContext();
      if (ctx) setAudioArmed(true);
    };
    window.addEventListener('click', handleGesture, { once: true });
    window.addEventListener('keydown', handleGesture, { once: true });
    return () => {
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, []);

  // Auto-silence siren once all unassigned cases are cleared
  useEffect(() => {
    const unassignedCount = incidents.filter((i) => i.status === 'REPORTED' && !i.teamId).length;
    if (unassignedCount === 0 && sirenActive) {
      stopSiren();
    }
  }, [incidents, sirenActive]);

  useEffect(() => {
    teams.forEach(async (team) => {
      if (!team.latitude || !team.longitude) {
        setTeamAddresses((prev) => ({
          ...prev,
          [team.id]: 'At Fire Station Base (Ready for Deployment)',
        }));
        return;
      }

      const coordKey = `${team.latitude.toFixed(3)},${team.longitude.toFixed(3)}`;
      if (globalGeoCache[coordKey]) {
        setTeamAddresses((prev) => ({ ...prev, [team.id]: globalGeoCache[coordKey] }));
        return;
      }

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${team.latitude}&lon=${team.longitude}`
        );
        const resData = await res.json();
        if (resData?.display_name) {
          const parts = resData.display_name.split(',').map((p: string) => p.trim());
          const clean = parts.slice(0, 3).join(', ');
          globalGeoCache[coordKey] = clean;
          setTeamAddresses((prev) => ({ ...prev, [team.id]: clean }));
        } else {
          const fallback = `Live Squad Spot (${team.latitude.toFixed(4)}, ${team.longitude.toFixed(4)})`;
          globalGeoCache[coordKey] = fallback;
          setTeamAddresses((prev) => ({ ...prev, [team.id]: fallback }));
        }
      } catch {
        const fallback = `Live Squad Spot (${team.latitude.toFixed(4)}, ${team.longitude.toFixed(4)})`;
        setTeamAddresses((prev) => ({ ...prev, [team.id]: fallback }));
      }
    });
  }, [teams]);

  // Dynamic Road Route Generation: Squad -> Incident
  useEffect(() => {
    const activeAssignedIncidents = incidents.filter(
      (inc) =>
        inc.status !== 'RESOLVED' &&
        inc.status !== 'CONTAINED' &&
        inc.team &&
        hasValidCoordinates(inc.team.latitude, inc.team.longitude) &&
        hasValidCoordinates(inc.latitude, inc.longitude)
    );

    activeAssignedIncidents.forEach((inc) => {
      const tLat = inc.team!.latitude!;
      const tLng = inc.team!.longitude!;
      const vLat = inc.latitude!;
      const vLng = inc.longitude!;

      const dist = computeDistanceKm(tLat, tLng, vLat, vLng);
      if (dist < 0.015) {
        setSquadRoadRoutes((prev) => ({ ...prev, [inc.id]: [] }));
        setSquadRouteSummaries((prev) => ({
          ...prev,
          [inc.id]: { distanceKm: dist, etaMinutes: 0 },
        }));
        return;
      }

      const routeKey = `${tLat},${tLng}:${vLat},${vLng}`;
      if (routeKeysRef.current[inc.id] === routeKey) return;
      routeKeysRef.current[inc.id] = routeKey;
      routeControllersRef.current[inc.id]?.abort();
      const controller = new AbortController();
      routeControllersRef.current[inc.id] = controller;
      setSquadRouteSummaries((prev) => ({ ...prev, [inc.id]: null }));

      fetchDrivingRoute([tLat, tLng], [vLat, vLng], controller.signal)
        .then((route) => {
          if (controller.signal.aborted) return;
          setSquadRoadRoutes((prev) => ({ ...prev, [inc.id]: route.coordinates }));
          setSquadRouteSummaries((prev) => ({
            ...prev,
            [inc.id]: { distanceKm: route.distanceKm, etaMinutes: route.durationMinutes },
          }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSquadRoadRoutes((prev) => ({ ...prev, [inc.id]: [] }));
          setSquadRouteSummaries((prev) => ({ ...prev, [inc.id]: null }));
        });
    });
  }, [incidents, teams]);

  useEffect(
    () => () => Object.values(routeControllersRef.current).forEach((controller) => controller.abort()),
    []
  );

  useEffect(() => {
    (async () => {
      const L = await import('leaflet');

      const victimIcon = L.divIcon({
        className: 'incident-pin',
        html: `
          <div style="
            background: #ef4444;
            border: 3px solid #ffffff;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            box-shadow: 0 0 16px rgba(239, 68, 68, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
          ">
            🔥
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const availableTeamIcon = L.divIcon({
        className: 'available-team-pin',
        html: `
          <div style="
            background: #10b981;
            border: 3px solid #ffffff;
            border-radius: 50%;
            width: 42px;
            height: 42px;
            box-shadow: 0 0 16px rgba(16, 185, 129, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
          ">
            🚒
          </div>
        `,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });

      const dispatchedTeamIcon = L.divIcon({
        className: 'dispatched-team-pin',
        html: `
          <div style="
            background: #f59e0b;
            border: 3px solid #ffffff;
            border-radius: 50%;
            width: 42px;
            height: 42px;
            box-shadow: 0 0 18px rgba(245, 158, 11, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
          ">
            🚨
          </div>
        `,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });

      const offDutyTeamIcon = L.divIcon({
        className: 'offduty-team-pin',
        html: `
          <div style="
            background: #64748b;
            border: 3px solid #ffffff;
            border-radius: 50%;
            width: 38px;
            height: 38px;
            box-shadow: 0 0 12px rgba(100, 116, 139, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
          ">
            ⚪
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });

      const stationIcon = L.divIcon({
        className: 'station-pin',
        html: `
          <div style="
            background: #3b82f6;
            border: 3px solid #ffffff;
            border-radius: 12px;
            width: 40px;
            height: 40px;
            box-shadow: 0 0 16px rgba(59, 130, 246, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
          ">
            🏢
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      setLeafletIcons({ victimIcon, availableTeamIcon, dispatchedTeamIcon, offDutyTeamIcon, stationIcon });
    })();
  }, []);

  useSubscription<{ incidentCreated: Incident }>(ON_INCIDENT_CREATED, {
    onData: ({ data: subData }) => {
      const created = subData?.data?.incidentCreated;
      if (created) {
        setIncidents((prev) => [created, ...prev.filter((i) => i.id !== created.id)]);
        setLatestEmergency(`${created.title} - ${created.location}`);
        triggerStationAlert(created.title, created.location);
      }
    },
  });

  // Zero-Latency Direct In-Memory Synchronization (<50ms)
  useSubscription<{ incidentStatusUpdated: IncidentStatusUpdate }>(ON_INCIDENT_STATUS_UPDATED, {
    onData: ({ data: subData }) => {
      const updated = subData?.data?.incidentStatusUpdated;
      if (updated) {
        if (updated.id === '__CLEAR__') {
          setIncidents((prev) => prev.filter((i) => i.status !== 'RESOLVED'));
          return;
        }

        setIncidents((prev) =>
          prev.map((i) =>
            i.id === updated.id
              ? {
                  ...i,
                  status: updated.status,
                  teamId: updated.teamId !== undefined ? updated.teamId : i.teamId,
                  team: updated.team !== undefined ? updated.team : i.team,
                  reportedAt: updated.reportedAt || i.reportedAt,
                  routedAt: updated.routedAt || i.routedAt,
                  reachedSceneAt: updated.reachedSceneAt || i.reachedSceneAt,
                  containedAt: updated.containedAt || i.containedAt,
                  resolvedAt: updated.resolvedAt || i.resolvedAt,
                }
              : i
          )
        );
      }
    },
  });

  useSubscription<{ teamStatusUpdated: TeamStatusUpdate }>(ON_TEAM_STATUS_UPDATED, {
    onData: ({ data: subData }) => {
      const teamUpdated = subData?.data?.teamStatusUpdated;
      if (teamUpdated) {
        if (teamUpdated.status === 'DELETED') {
          setTeams((prev) => prev.filter((t) => t.id !== teamUpdated.id));
        } else {
          setTeams((prev) =>
            prev.map((t) =>
              t.id === teamUpdated.id
                ? {
                    ...t,
                    status: teamUpdated.status,
                    latitude: teamUpdated.latitude ?? t.latitude,
                    longitude: teamUpdated.longitude ?? t.longitude,
                  }
                : t
            )
          );
        }
      }
    },
  });

  const handleCreateTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = teamForm.name.trim();
    const leaderName = teamForm.leaderName.trim();
    const phone = teamForm.phone.trim();

    if (!name || !leaderName || !phone) {
      setFormError('Please fill out all squad fields.');
      return;
    }

    try {
      const res = await createTeam({
        variables: { name, type: teamForm.type, leaderName, phone },
      });

      if (res?.data?.createTeam) {
        const newTeam = res.data.createTeam;
        setTeams((prev) => [...prev, newTeam]);
        setIsAddTeamModalOpen(false);
        setTeamForm({ name: '', type: 'WATER_TENDER', leaderName: '', phone: '' });
      }
      refetch();
    } catch (err: any) {
      setFormError(err.message || 'Server error creating squad.');
    }
  };

  const handleUpdateTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam) return;

    const updated = { ...editingTeam };
    setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setEditingTeam(null);

    await updateTeam({
      variables: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        leaderName: updated.leaderName,
        phone: updated.phone,
        status: updated.status,
      },
    });

    refetch();
  };

  const handleDeleteTeam = async (teamId: string, teamName: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to remove squad "${teamName}" from the fleet?`
    );
    if (!confirmed) return;

    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    try {
      await deleteTeam({ variables: { id: teamId } });
    } catch {}
    refetch();
  };

  const handleClearHistory = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to erase all solved cases from the history log?'
    );
    if (!confirmed) return;

    setIncidents((prev) => prev.filter((i) => i.status !== 'RESOLVED'));
    await clearResolvedHistory();
    refetch();
  };

  // Optional Assign Action: Explicit confirmation button
  const handleConfirmAssignment = async (incidentId: string) => {
    const teamId = pendingSquadSelection[incidentId];
    if (!teamId) {
      alert('Please select a squad from the list before dispatching.');
      return;
    }

    // Direct local state patch for immediate feedback
    const chosenTeam = teams.find((t) => t.id === teamId);
    setIncidents((prev) =>
      prev.map((i) =>
        i.id === incidentId
          ? {
              ...i,
              teamId,
              team: chosenTeam || i.team,
            }
          : i
      )
    );

    await assignTeam({ variables: { incidentId, teamId } });
    setReassigningIncidentId(null);
    stopSiren();
    refetch();
  };

  const playVictimVoice = (audioData: string, incidentId: string) => {
    if (!audioData) return;
    const audio = new Audio(audioData);
    setPlayingAudioId(incidentId);
    audio.play();
    audio.onended = () => setPlayingAudioId(null);
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

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return '';
    try {
      return new Date(isoString).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const activeIncidents = incidents.filter((i) => i.status !== 'RESOLVED');
  const resolvedIncidents = incidents.filter((i) => i.status === 'RESOLVED');

  const availableOnDutyTeams = teams.filter(
    (t) => t.id && t.name && t.status === 'AVAILABLE'
  );
  const dispatchedTeams = teams.filter(
    (t) => t.id && t.name && t.status === 'DISPATCHED'
  );
  const offDutyTeams = teams.filter(
    (t) => t.id && t.name && t.status === 'OFF_DUTY'
  );

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* 1. LOUD VISUAL & AUDIO EMERGENCY ALERT BANNER */}
      {sirenActive && (
        <div className="bg-red-600 border-4 border-white p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-bounce shadow-[0_0_60px_rgba(239,68,68,1)]">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-12 h-12 text-white animate-pulse" />
            <div>
              <h3 className="text-white font-black text-xl sm:text-2xl tracking-wider uppercase">
                🚨 CRITICAL FIRE REPORTED — IMMEDIATE OPERATOR DISPATCH REQUIRED
              </h3>
              <p className="text-red-100 text-sm font-bold">
                {latestEmergency || 'Emergency reported. Select a squad below or keep on evaluation.'}
              </p>
            </div>
          </div>
          <button
            onClick={stopSiren}
            className="flex items-center gap-2 bg-black hover:bg-slate-900 text-white font-black px-6 py-3 rounded-xl border border-red-400 shadow-xl cursor-pointer transition text-sm shrink-0"
          >
            <VolumeX className="w-5 h-5 text-red-400" />
            SILENCE SIREN
          </button>
        </div>
      )}

      {/* 2. AUDIO ARMING BANNER */}
      {!audioArmed && (
        <div className="bg-amber-500/10 border-2 border-amber-500/40 p-3.5 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-300">
          <div className="flex items-center gap-2 font-medium">
            <Volume2 className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
            <span>
              Browser autoplay protection is active. Click <strong>"Enable Audio Siren"</strong> to allow instant alarms when fire reports arrive.
            </span>
          </div>
          <button
            onClick={armAudioSystem}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-lg transition shrink-0 cursor-pointer"
          >
            Enable Audio Siren
          </button>
        </div>
      )}

      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-5 gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-red-600/20 rounded-xl border border-red-600/40 text-red-500">
            <Flame className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              FireResQ Command Center
            </h1>
            <p className="text-sm text-slate-400">
              Autonomous Dispatch, Multi-Squad Routing & Fleet Operations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (sirenActive) {
                stopSiren();
              } else {
                startSiren();
              }
            }}
            className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full border cursor-pointer transition ${
              sirenActive
                ? 'bg-red-600 border-red-400 text-white animate-pulse'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            }`}
          >
            <BellRing className="w-3.5 h-3.5" />
            <span>{sirenActive ? 'STOP SIREN' : 'TEST SIREN SOUND'}</span>
          </button>

          <div className="flex items-center space-x-2 text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3.5 py-1.5 rounded-full">
            <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
            <span className="font-semibold tracking-wider">LIVE WEBSOCKET STREAM</span>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('ACTIVE')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
              activeTab === 'ACTIVE'
                ? 'bg-red-600 text-white font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            Active Operations ({activeIncidents.length})
          </button>

          <button
            onClick={() => setActiveTab('RESOLVED')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
              activeTab === 'RESOLVED'
                ? 'bg-emerald-600 text-white font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Archive className="w-4 h-4" />
            Solved Cases History ({resolvedIncidents.length})
          </button>

          <button
            onClick={() => setActiveTab('FLEET')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
              activeTab === 'FLEET'
                ? 'bg-blue-600 text-white font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Truck className="w-4 h-4" />
            Fire Teams & Fleet ({teams.length})
          </button>
        </div>

        {activeTab === 'RESOLVED' && resolvedIncidents.length > 0 && (
          <button
            onClick={handleClearHistory}
            disabled={clearingHistory}
            className="flex items-center gap-1.5 text-xs bg-red-600/20 hover:bg-red-600/40 border border-red-500/50 text-red-300 font-bold px-3.5 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{clearingHistory ? 'Erasing...' : 'Clear Resolved History'}</span>
          </button>
        )}
      </div>

      {activeTab === 'ACTIVE' && (
        <section className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
              <div className="flex items-center gap-2 text-white font-semibold">
                <Layers className="w-5 h-5 text-red-500" />
                <span>Multi-Squad Tactical Operations Map (Live Road Routes)</span>
              </div>

              <div className="flex items-center gap-4 text-xs font-medium">
                <div className="flex items-center gap-1.5 text-blue-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                  <span>Station Base</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                  <span>On Duty ({availableOnDutyTeams.length})</span>
                </div>
                <div className="flex items-center gap-1.5 text-amber-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                  <span>Dispatched ({dispatchedTeams.length})</span>
                </div>
                <div className="flex items-center gap-1.5 text-blue-400">
                  <span className="w-4 h-1 bg-blue-600 inline-block rounded" />
                  <span>Allotted Road Routes</span>
                </div>
                <button
                  onClick={() => setShowMap(!showMap)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded-lg border border-slate-700 cursor-pointer transition ml-2"
                >
                  {showMap ? 'Hide Map' : 'Show Map'}
                </button>
              </div>
            </div>

            {leafletIcons && (
              <div className="h-96 w-full rounded-2xl overflow-hidden border border-slate-800 relative z-0 shadow-2xl">
                {showMap && (
                  <TacticalMap
                    key="tactical-map-visible"
                    teams={teams}
                    incidents={activeIncidents}
                    routes={squadRoadRoutes}
                    teamAddresses={teamAddresses}
                    icons={leafletIcons}
                    visible={true}
                  />
                )}
              </div>
            )}
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-white tracking-wide">
                  Live Fleet Squad Status & Standing Locations
                </h2>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2.5 py-1 rounded-lg">
                  On Duty: {availableOnDutyTeams.length}
                </span>
                <span className="bg-amber-500/10 border border-amber-500/30 text-amber-400 px-2.5 py-1 rounded-lg">
                  Dispatched: {dispatchedTeams.length}
                </span>
                <span className="bg-slate-800 border border-slate-700 text-slate-400 px-2.5 py-1 rounded-lg">
                  Off Duty: {offDutyTeams.length}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {teams.map((team) => {
                const isAvailable = team.status === 'AVAILABLE';
                const isDispatched = team.status === 'DISPATCHED';
                const isOffDuty = team.status === 'OFF_DUTY';
                const standAddress = teamAddresses[team.id] || 'At Station Base / Locating...';

                return (
                  <div
                    key={team.id}
                    className={`bg-slate-950 p-4 rounded-xl border space-y-2.5 transition ${
                      isAvailable
                        ? 'border-emerald-500/40 hover:border-emerald-500'
                        : isDispatched
                        ? 'border-amber-500/40 hover:border-amber-500'
                        : 'border-slate-800 hover:border-slate-700 opacity-80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-white text-sm flex items-center gap-1.5">
                          <span>{isOffDuty ? '⚪' : '🚒'}</span>
                          {team.name}
                        </h3>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                          {team.type}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                          isAvailable
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : isDispatched
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        {isAvailable ? 'ON DUTY (READY)' : isDispatched ? 'DISPATCHED' : 'OFF DUTY'}
                      </span>
                    </div>

                    <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80 space-y-1">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-red-400" />
                        Standing Location (Landmark)
                      </span>
                      <p className="text-xs text-slate-200 font-medium leading-relaxed">
                        {standAddress}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-900 text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        <span>{team.leaderName}</span>
                      </div>
                      <a
                        href={`tel:${team.phone}`}
                        className="font-mono text-emerald-400 font-bold hover:underline flex items-center gap-1"
                      >
                        <Phone className="w-3 h-3" />
                        {team.phone}
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
              <Clock className="w-5 h-5 text-red-500" />
              Incoming Emergency Queue ({activeIncidents.length})
            </h2>

            {activeIncidents.length === 0 ? (
              <div className="p-12 text-center text-slate-500 border border-slate-800 rounded-2xl">
                No active incidents right now. All situations are under control.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeIncidents.map((incident) => {
                  const isAssigned = !!incident.team && reassigningIncidentId !== incident.id;

                  return (
                    <div
                      key={incident.id}
                      className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-4 shadow-lg"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-white text-base leading-snug">
                            {incident.title}
                          </h3>
                          <div className="flex items-center text-xs text-slate-400 gap-1.5 mt-1">
                            <MapPin className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            <span className="line-clamp-2">{incident.location}</span>
                          </div>
                        </div>
                        <span className="text-xs bg-red-600 text-white font-bold px-2.5 py-1 rounded-md shrink-0">
                          {incident.status}
                        </span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider block">
                            Transcribed Victim Voice Statement
                          </span>
                          {incident.audioData && (
                            <button
                              onClick={() => playVictimVoice(incident.audioData!, incident.id)}
                              className="flex items-center gap-1 text-[11px] bg-amber-500/20 border border-amber-500/40 text-amber-300 px-2.5 py-0.5 rounded-full font-bold hover:bg-amber-500/30 transition cursor-pointer"
                            >
                              <Play className="w-3 h-3" />
                              <span>{playingAudioId === incident.id ? 'Playing...' : 'Play Audio Recording'}</span>
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-200 italic">"{incident.description}"</p>
                      </div>

                      {/* OPTIONAL / FLEXIBLE SQUAD ASSIGNMENT WORKFLOW */}
                      <div className="pt-3 border-t border-slate-800">
                        {isAssigned ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between w-full bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-800 text-xs">
                              <div className="flex items-center gap-2">
                                <Truck className="w-4 h-4 text-emerald-400" />
                                <span className="text-white font-bold">{incident.team?.name}</span>
                                <span className="text-slate-400">({incident.team?.leaderName})</span>
                              </div>
                              <button
                                onClick={() => setReassigningIncidentId(incident.id)}
                                className="text-[11px] text-amber-400 hover:text-amber-300 underline font-medium cursor-pointer"
                              >
                                Change Squad
                              </button>
                            </div>

                            <div className="flex items-center justify-between bg-slate-950/60 border border-slate-800 px-3 py-2 rounded-xl text-xs">
                              <span className="text-slate-400 font-medium">Squad Field Status:</span>
                              <div className="flex items-center gap-1.5 font-bold">
                                {incident.status === 'IN_ROUTING' && (
                                  <span className="text-amber-400 flex items-center gap-1 animate-pulse">
                                    <Radio className="w-3 h-3" /> EN ROUTE TO SCENE
                                  </span>
                                )}
                                {incident.status === 'REACHED_SCENE' && (
                                  <span className="text-red-400 flex items-center gap-1">
                                    <MapPin className="w-3 h-3" /> AT EMERGENCY SCENE
                                  </span>
                                )}
                                {incident.status === 'CONTAINED' && (
                                  <span className="text-blue-400 flex items-center gap-1">
                                    <ShieldAlert className="w-3 h-3" /> FIRE CONTAINED
                                  </span>
                                )}
                                {incident.status === 'RESOLVED' && (
                                  <span className="text-emerald-400 flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" /> MISSION RESOLVED
                                  </span>
                                )}
                                {incident.status === 'REPORTED' && (
                                  <span className="text-slate-400">
                                    Assigned • Awaiting Squad Takeoff
                                  </span>
                                )}
                              </div>
                            </div>
                            {hasValidCoordinates(incident.team?.latitude, incident.team?.longitude) &&
                            hasValidCoordinates(incident.latitude, incident.longitude) ? (
                              <p className="text-[11px] text-emerald-300">
                                {squadRouteSummaries[incident.id]
                                  ? squadRouteSummaries[incident.id]!.etaMinutes === 0
                                    ? 'Squad at destination'
                                    : `Driving route: ${squadRouteSummaries[incident.id]!.distanceKm.toFixed(1)} km · about ${squadRouteSummaries[incident.id]!.etaMinutes} min`
                                  : 'Calculating road route and arrival time...'}
                                <span className="text-slate-500"> · traffic not included</span>
                              </p>
                            ) : (
                              <p className="text-[11px] text-amber-300">
                                Road ETA unavailable until squad and incident GPS are available.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="w-full space-y-2.5 bg-slate-950 p-3 rounded-xl border border-amber-500/40">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">
                                Choose Squad (Optional / Standby Allowed):
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {availableOnDutyTeams.length} Squads On Duty
                              </span>
                            </div>

                            <select
                              value={pendingSquadSelection[incident.id] || ''}
                              onChange={(e) =>
                                setPendingSquadSelection({
                                  ...pendingSquadSelection,
                                  [incident.id]: e.target.value,
                                })
                              }
                              className="w-full bg-slate-900 border border-slate-700 text-xs text-white font-medium p-2.5 rounded-lg focus:outline-none cursor-pointer"
                            >
                              <option value="">-- Keep On Standby (Do Not Assign Yet) --</option>
                              {availableOnDutyTeams
                                .map((team) => {
                                  const hasTeamLocation = hasValidCoordinates(team.latitude, team.longitude);
                                  const hasIncidentLocation = hasValidCoordinates(incident.latitude, incident.longitude);
                                  const distKm = hasTeamLocation && hasIncidentLocation
                                    ? computeDistanceKm(team.latitude!, team.longitude!, incident.latitude!, incident.longitude!)
                                    : null;
                                  return { ...team, distKm };
                                })
                                .sort((a, b) => (a.distKm ?? Infinity) - (b.distKm ?? Infinity))
                                .map((team) => (
                                  <option key={team.id} value={team.id}>
                                    🚒 {team.name} — {team.distKm == null
                                      ? 'GPS unavailable'
                                      : `${team.distKm.toFixed(1)} km straight-line; road ETA after dispatch`} • {team.leaderName}
                                  </option>
                                ))}
                            </select>

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => handleConfirmAssignment(incident.id)}
                                disabled={!pendingSquadSelection[incident.id]}
                                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs rounded-lg transition cursor-pointer"
                              >
                                Dispatch Selected Squad
                              </button>
                              {reassigningIncidentId === incident.id && (
                                <button
                                  onClick={() => setReassigningIncidentId(null)}
                                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'RESOLVED' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Solved Emergency Operations History ({resolvedIncidents.length})
            </h2>
          </div>

          {resolvedIncidents.length === 0 ? (
            <div className="p-12 text-center text-slate-500 border border-slate-800 rounded-2xl">
              No closed incidents yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {resolvedIncidents.map((incident) => (
                <div
                  key={incident.id}
                  className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl space-y-4 shadow-xl"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-base">{incident.title}</h3>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded font-bold">
                          RESOLVED
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-500" />
                        {incident.location}
                      </p>
                    </div>

                    <div className="text-right text-[11px] text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{formatDate(incident.reportedAt || incident.createdAt)}</span>
                    </div>
                  </div>

                  {incident.team && (
                    <div className="bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-800 text-xs flex items-center justify-between">
                      <span className="text-slate-400">Assigned Team:</span>
                      <span className="text-white font-bold">
                        {incident.team.name} ({incident.team.leaderName}) • {incident.team.phone}
                      </span>
                    </div>
                  )}

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block border-b border-slate-800 pb-1.5">
                      Mission Timestamp Progression
                    </span>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">1. Reported:</span>
                        <span className="text-white font-mono font-semibold">
                          {formatTime(incident.reportedAt || incident.createdAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">2. En Route:</span>
                        <span className="text-amber-400 font-mono font-semibold">
                          {formatTime(incident.routedAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">3. Reached Scene:</span>
                        <span className="text-red-400 font-mono font-semibold">
                          {formatTime(incident.reachedSceneAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">4. Fire Contained:</span>
                        <span className="text-blue-400 font-mono font-semibold">
                          {formatTime(incident.containedAt)}
                        </span>
                      </div>
                      <div className="col-span-2 pt-1 border-t border-slate-800">
                        <span className="text-slate-400 block text-[11px]">5. Mission Resolved:</span>
                        <span className="text-emerald-400 font-mono font-bold">
                          {formatTime(incident.resolvedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {incident.audioData && (
                    <button
                      onClick={() => playVictimVoice(incident.audioData!, incident.id)}
                      className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1.5 font-bold cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{playingAudioId === incident.id ? 'Playing...' : 'Play Recorded Victim Audio'}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'FLEET' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
              <Users className="w-5 h-5 text-blue-400" />
              Registered Fleet Squads ({teams.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((team) => (
              <div
                key={team.id}
                className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-3 relative flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-white text-base">{team.name}</h3>
                      <p className="text-xs text-slate-400 uppercase tracking-wider">{team.type}</p>
                    </div>

                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full border font-bold ${
                        team.status === 'AVAILABLE'
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                          : team.status === 'OFF_DUTY'
                          ? 'bg-slate-600/20 text-slate-300 border-slate-600/40'
                          : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                      }`}
                    >
                      {team.status === 'AVAILABLE' ? 'ON DUTY' : team.status}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-300">
                    <div className="flex items-center gap-2">
                      <User className="w-3.5 h-3.5 text-slate-500" />
                      <span>Leader: {team.leaderName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-slate-500" />
                      <span className="font-mono text-emerald-400 font-bold">{team.phone}</span>
                    </div>
                    <div className="flex items-start gap-2 pt-1 border-t border-slate-800 text-[11px] text-slate-400">
                      <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">
                        {teamAddresses[team.id] || 'At Station Base / Locating...'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-800/80">
                  <button
                    onClick={() => setEditingTeam(team)}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>

                  <button
                    onClick={() => handleDeleteTeam(team.id, team.name)}
                    className="flex items-center justify-center gap-1 px-3 py-2 bg-red-600/10 hover:bg-red-600/30 text-red-400 hover:text-red-300 border border-red-500/30 rounded-xl transition cursor-pointer text-xs font-semibold"
                    title="Delete Squad"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={() => {
                setFormError(null);
                setIsAddTeamModalOpen(true);
              }}
              className="border-2 border-dashed border-slate-800 hover:border-emerald-500/60 bg-slate-900/40 hover:bg-slate-900/80 p-8 rounded-2xl flex flex-col items-center justify-center gap-3 text-slate-400 hover:text-emerald-400 transition cursor-pointer min-h-42.5"
            >
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                <PlusCircle className="w-7 h-7 text-emerald-400" />
              </div>
              <div className="text-center">
                <span className="text-sm font-bold text-white block">Add New Squad</span>
                <span className="text-xs text-slate-500">Register truck, leader & phone</span>
              </div>
            </button>
          </div>
        </section>
      )}

      {isAddTeamModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md p-6 rounded-2xl space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-emerald-400" />
                Register New Fire Squad
              </h3>
              <button
                onClick={() => setIsAddTeamModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-300 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateTeamSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Squad / Truck Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Engine Squad 2"
                  value={teamForm.name}
                  onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Vehicle Type
                </label>
                <select
                  value={teamForm.type}
                  onChange={(e) => setTeamForm({ ...teamForm, type: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white [&>option]:bg-slate-900"
                >
                  <option value="WATER_TENDER">Water Tender (Heavy)</option>
                  <option value="QUICK_RESPONSE">Quick Response Vehicle (QRV)</option>
                  <option value="LADDER_TRUCK">Aerial Ladder Squad</option>
                  <option value="RESCUE_SQUAD">Hazmat / Rescue Unit</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Team Leader / Officer
                </label>
                <input
                  type="text"
                  placeholder="e.g. Officer Vinod"
                  value={teamForm.leaderName}
                  onChange={(e) => setTeamForm({ ...teamForm, leaderName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Phone Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. +91 99887 76655"
                  value={teamForm.phone}
                  onChange={(e) => setTeamForm({ ...teamForm, phone: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-mono"
                  required
                />
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddTeamModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingTeam}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold cursor-pointer disabled:opacity-50"
                >
                  {creatingTeam ? 'Registering...' : 'Register Squad'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingTeam && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md p-6 rounded-2xl space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-emerald-400" />
                Edit Squad: {editingTeam.name}
              </h3>
              <button
                onClick={() => setEditingTeam(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateTeamSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Squad / Truck Name
                </label>
                <input
                  type="text"
                  value={editingTeam.name}
                  onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Vehicle Type
                </label>
                <select
                  value={editingTeam.type}
                  onChange={(e) => setEditingTeam({ ...editingTeam, type: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white [&>option]:bg-slate-900"
                >
                  <option value="WATER_TENDER">Water Tender (Heavy)</option>
                  <option value="QUICK_RESPONSE">Quick Response Vehicle (QRV)</option>
                  <option value="LADDER_TRUCK">Aerial Ladder Squad</option>
                  <option value="RESCUE_SQUAD">Hazmat / Rescue Unit</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Team Leader / Officer
                </label>
                <input
                  type="text"
                  value={editingTeam.leaderName}
                  onChange={(e) => setEditingTeam({ ...editingTeam, leaderName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={editingTeam.phone}
                  onChange={(e) => setEditingTeam({ ...editingTeam, phone: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-mono"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold uppercase">
                  Squad Availability Status
                </label>
                <select
                  value={editingTeam.status}
                  onChange={(e) => setEditingTeam({ ...editingTeam, status: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white [&>option]:bg-slate-900"
                >
                  <option value="AVAILABLE">AVAILABLE (On Duty)</option>
                  <option value="DISPATCHED">DISPATCHED (Currently on Mission)</option>
                  <option value="OFF_DUTY">OFF DUTY (Unavailable)</option>
                  <option value="RETURNING">RETURNING (Maintenance / Travel)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingTeam(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingTeam}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold cursor-pointer disabled:opacity-50"
                >
                  {updatingTeam ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}