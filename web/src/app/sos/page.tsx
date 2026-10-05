'use client';

import { useState, useEffect, useRef } from 'react';
import { gql } from '@apollo/client';
import { useMutation, useQuery, useSubscription } from '@apollo/client/react';
import dynamic from 'next/dynamic';
import { fetchDrivingRoute, hasValidCoordinates } from '../../lib/road-routing';
import {
  Flame,
  Phone,
  Truck,
  MapPin,
  CheckCircle2,
  Radio,
  Volume2,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';

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
        victimPos,
        truckPos,
      }: {
        victimPos: [number, number];
        truckPos?: [number, number] | null;
      }) {
        const map = useMap();
        useEffect(() => {
          if (!map) return;
          if (truckPos && (truckPos[0] !== victimPos[0] || truckPos[1] !== victimPos[1])) {
            map.fitBounds([victimPos, truckPos], { padding: [50, 50], maxZoom: 16 });
          } else {
            map.setView(victimPos, 16);
          }
        }, [map, victimPos, truckPos]);
        return null;
      };
    }),
  { ssr: false }
);

const REPORT_INCIDENT = gql`
  mutation ReportIncident(
    $title: String!
    $description: String!
    $location: String!
    $severity: String!
    $latitude: Float
    $longitude: Float
    $audioData: String
  ) {
    reportIncident(
      title: $title
      description: $description
      location: $location
      severity: $severity
      latitude: $latitude
      longitude: $longitude
      audioData: $audioData
    ) {
      id
      title
      description
      location
      severity
      status
      latitude
      longitude
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
      audioData
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
    }
  }
`;

const ON_TEAM_STATUS_UPDATED = gql`
  subscription OnTeamStatusUpdated {
    teamStatusUpdated {
      id
      status
      latitude
      longitude
    }
  }
`;

const GET_INCIDENTS = gql`
  query SosTrackedIncidents {
    incidents {
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

type SosTeam = {
  id: string;
  name: string;
  type: string;
  leaderName: string;
  phone: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
};

type SosTrackedIncident = {
  id: string;
  status: string;
  teamId: string | null;
  team: SosTeam | null;
};

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

export default function VictimSOSPortal() {
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({
    lat: 13.2554,
    lng: 76.4782,
  });
  const [hasGpsFix, setHasGpsFix] = useState(false);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [gpsMessage, setGpsMessage] = useState('Acquiring high-precision GPS...');
  const [detailedAddress, setDetailedAddress] = useState('Acquiring high-precision GPS...');
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [promptSpoken, setPromptSpoken] = useState('');
  const [reportedIncidentState, setReportedIncident] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [leafletIcons, setLeafletIcons] = useState<{ victimIcon: any; teamIcon: any } | null>(null);
  const [resolvedCountdown, setResolvedCountdown] = useState<number>(5);
  const [activeRemainingRoute, setActiveRemainingRoute] = useState<[number, number][]>([]);
  const [roadRouteSummary, setRoadRouteSummary] = useState<{
    distanceKm: number;
    etaMinutes: number;
  } | null>(null);
  const [recordingSecondsRemaining, setRecordingSecondsRemaining] = useState(20);
  const [voiceNoteBytes, setVoiceNoteBytes] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecordingResultRef = useRef<Promise<string> | null>(null);
  const resolveAudioRecordingRef = useRef<((audio: string) => void) | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const gpsFixRef = useRef<{ lat: number; lng: number; accuracy: number } | null>(null);
  const locationAddressRef = useRef('GPS location unavailable');
  const voiceCaptureActiveRef = useRef(false);
  const sosButtonPressedRef = useRef(false);
  const voiceDispatchStartedRef = useRef(false);
  const speechRecognitionFailedRef = useRef(false);
  const voiceTranscriptRef = useRef('');
  const voiceRecordingTimerRef = useRef<number | null>(null);
  const recognitionRestartTimerRef = useRef<number | null>(null);
  const lastSpokenEtaRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  const [reportIncident, { loading: sendingSOS }] = useMutation<{ reportIncident: any }>(REPORT_INCIDENT);
  const reportedIncidentId = reportedIncidentState?.id;
  const { data: incidentData } = useQuery<{ incidents: SosTrackedIncident[] }>(GET_INCIDENTS, {
    skip: !reportedIncidentId,
    pollInterval: reportedIncidentId ? 1500 : 0,
    fetchPolicy: 'network-only',
  });
  const polledIncident = incidentData?.incidents?.find((incident) => incident.id === reportedIncidentId);
  const reportedIncident = reportedIncidentState && polledIncident
    ? {
        ...reportedIncidentState,
        status: polledIncident.status,
        teamId: polledIncident.teamId,
        team: polledIncident.team
          ? { ...reportedIncidentState.team, ...polledIncident.team }
          : reportedIncidentState.team,
      }
    : reportedIncidentState;

  useEffect(() => {
    (async () => {
      const L = await import('leaflet');

      const victimIcon = L.divIcon({
        className: 'custom-victim-pin',
        html: `
          <div style="
            background: #ef4444;
            border: 3px solid #ffffff;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            box-shadow: 0 0 16px rgba(239, 68, 68, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
          ">
            🔥
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      const teamIcon = L.divIcon({
        className: 'custom-team-pin',
        html: `
          <div style="
            background: #10b981;
            border: 3px solid #ffffff;
            border-radius: 50%;
            width: 44px;
            height: 44px;
            box-shadow: 0 0 18px rgba(16, 185, 129, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
          ">
            🚒
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });

      setLeafletIcons({ victimIcon, teamIcon });
    })();
  }, []);

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    const fallbackAddress = `Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
        { signal: controller.signal }
      );
      const data = await res.json();
      if (data?.display_name) {
        const parts = data.display_name.split(',').map((p: string) => p.trim());
        const address = parts.slice(0, 4).join(', ');
        locationAddressRef.current = address;
        setDetailedAddress(address);
        return address;
      }
    } catch {
      // Use coordinates when reverse geocoding is unavailable.
    } finally {
      window.clearTimeout(timeout);
    }
    locationAddressRef.current = fallbackAddress;
    setDetailedAddress(fallbackAddress);
    return fallbackAddress;
  };

  const acquireLocation = () => {
    if (!window.isSecureContext) {
      setGpsMessage('Live GPS requires HTTPS. Open this page securely and allow location access.');
      return;
    }
    if (!('geolocation' in navigator)) {
      setGpsMessage('This browser does not support live location.');
      return;
    }
    setGpsMessage('Acquiring high-precision GPS...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        gpsFixRef.current = {
          lat: latitude,
          lng: longitude,
          accuracy: pos.coords.accuracy,
        };
        setCoords({ lat: latitude, lng: longitude });
        setHasGpsFix(true);
        setGpsAccuracyMeters(pos.coords.accuracy);
        setGpsMessage('Live GPS location locked.');
        const coordinateAddress = `GPS ±${Math.round(pos.coords.accuracy)} m · ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        locationAddressRef.current = coordinateAddress;
        setDetailedAddress(coordinateAddress);
        reverseGeocode(latitude, longitude);
      },
      (error) => {
        setGpsMessage(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied. Allow location access to report your real position.'
            : 'Unable to acquire GPS. Check location services and try again.'
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  };

  useEffect(() => {
    acquireLocation();
    if (!window.isSecureContext || !('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        gpsFixRef.current = {
          lat: latitude,
          lng: longitude,
          accuracy: pos.coords.accuracy,
        };
        setCoords({ lat: latitude, lng: longitude });
        setHasGpsFix(true);
        setGpsAccuracyMeters(pos.coords.accuracy);
        setGpsMessage('Live GPS location locked.');
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGpsMessage('Location permission denied. Allow location access to report your real position.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    const team = reportedIncident?.team;
    const incident = reportedIncident;
    if (
      !team ||
      !hasValidCoordinates(team.latitude, team.longitude) ||
      !hasValidCoordinates(incident?.latitude, incident?.longitude)
    ) {
      setActiveRemainingRoute([]);
      setRoadRouteSummary(null);
      return;
    }

    const origin: [number, number] = [team.latitude, team.longitude];
    const destination: [number, number] = [incident.latitude, incident.longitude];
    const dist = computeDistanceKm(...origin, ...destination);
    if (dist < 0.015) {
      setActiveRemainingRoute([]);
      setRoadRouteSummary({ distanceKm: dist, etaMinutes: 0 });
      return;
    }

    setRoadRouteSummary(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const route = await fetchDrivingRoute(origin, destination, controller.signal);
        setActiveRemainingRoute(route.coordinates);
        setRoadRouteSummary({
          distanceKm: route.distanceKm,
          etaMinutes: route.durationMinutes,
        });
      } catch {
        if (controller.signal.aborted) return;
        setActiveRemainingRoute([]);
        setRoadRouteSummary(null);
      }
    }, 750);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    reportedIncident?.team?.latitude,
    reportedIncident?.team?.longitude,
    reportedIncident?.latitude,
    reportedIncident?.longitude,
  ]);

  const startAudioRecording = async (): Promise<boolean> => {
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setPromptSpoken('Audio recording is not supported by this browser. The SOS will still be sent.');
        return false;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      setVoiceNoteBytes(0);
      const supportedMimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
      ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const mediaRecorder = new MediaRecorder(stream, {
        ...(supportedMimeType ? { mimeType: supportedMimeType } : {}),
        audioBitsPerSecond: 32000,
      });
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      mediaRecorder.onerror = () => {
        setPromptSpoken('Microphone recording failed. The SOS will still be sent.');
        resolveAudioRecordingRef.current?.('');
        stream?.getTracks().forEach((track) => track.stop());
      };
      audioRecordingResultRef.current = new Promise((resolve) => {
        resolveAudioRecordingRef.current = resolve;
      });
      mediaRecorder.addEventListener('stop', () => {
        const mimeType = mediaRecorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setVoiceNoteBytes(audioBlob.size);
        if (audioBlob.size === 0) {
          setPromptSpoken('No audio data was captured. Check microphone permission and try again.');
          resolveAudioRecordingRef.current?.('');
          stream?.getTracks().forEach((track) => track.stop());
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => resolveAudioRecordingRef.current?.((reader.result as string) || '');
        reader.onerror = () => resolveAudioRecordingRef.current?.('');
        reader.readAsDataURL(audioBlob);
        stream?.getTracks().forEach((track) => track.stop());
      }, { once: true });
      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      return true;
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      setPromptSpoken('Microphone permission is unavailable. The SOS will still be sent.');
      return false;
    }
  };

  const stopAudioRecording = (): Promise<string> => {
    const recorder = mediaRecorderRef.current;
    const audioResult = audioRecordingResultRef.current;
    if (!recorder || !audioResult) return Promise.resolve('');

    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        resolveAudioRecordingRef.current?.('');
      }
    }
    return audioResult;
  };

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-IN';

      recognition.onresult = (event: any) => {
        const transcripts: string[] = [];
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          if (event.results[index].isFinal) {
            transcripts.push(event.results[index][0].transcript.trim());
          }
        }
        if (transcripts.length > 0) {
          voiceTranscriptRef.current = [voiceTranscriptRef.current, ...transcripts]
            .filter(Boolean)
            .join(' ');
          setPromptSpoken('Voice captured. Keep speaking; recording ends in 20 seconds.');
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          speechRecognitionFailedRef.current = true;
          setPromptSpoken('Speech recognition is unavailable. Audio recording will continue.');
        }
      };

      recognition.onend = () => {
        if (
          voiceCaptureActiveRef.current &&
          !voiceDispatchStartedRef.current &&
          !speechRecognitionFailedRef.current
        ) {
          recognitionRestartTimerRef.current = window.setTimeout(() => {
            try {
              recognition.start();
            } catch {
              speechRecognitionFailedRef.current = true;
            }
          }, 300);
        }
      };

      recognitionRef.current = recognition;
    }
    return () => {
      if (recognitionRestartTimerRef.current != null) {
        window.clearTimeout(recognitionRestartTimerRef.current);
      }
      recognitionRef.current?.abort?.();
    };
  }, []);

  const dispatchSOS = async (voiceStatement: string, base64Audio: string) => {
    if (!sosButtonPressedRef.current) return;
    const gpsFix = gpsFixRef.current;
    try {
      const humanReadableLocation = gpsFix
        ? await reverseGeocode(gpsFix.lat, gpsFix.lng)
        : 'GPS location unavailable. Use the victim voice note to confirm the location.';
      const result = await reportIncident({
        variables: {
          title: 'CRITICAL EMERGENCY: Fire Incident Reported',
          description: voiceStatement,
          location: gpsFix
            ? `${humanReadableLocation} (GPS accuracy ±${Math.round(gpsFix.accuracy)} m)`
            : humanReadableLocation,
          severity: 'CRITICAL',
          latitude: gpsFix?.lat ?? null,
          longitude: gpsFix?.lng ?? null,
          audioData: base64Audio || null,
        },
      });

      if (result?.data?.reportIncident) {
        const created = result.data.reportIncident;
        setReportedIncident(created);
        sosButtonPressedRef.current = false;
        const voiceNoteSaved = Boolean(base64Audio && created.audioData);
        const voiceNoteSize = `${(voiceNoteBytes / 1024).toFixed(0)} KB`;
        setPromptSpoken(voiceNoteSaved
          ? gpsFix
            ? `SOS and ${voiceNoteSize} voice note sent to the station.`
            : `SOS and ${voiceNoteSize} voice note sent. GPS is unavailable; tell the station your location.`
          : 'SOS report sent, but no voice note was saved. Check microphone permission and retry.');
      }
    } catch (err) {
      console.error(err);
      setPromptSpoken('Emergency could not be sent. Check your connection and try again.');
    }
  };

  const finishVoiceCapture = async () => {
    if (!sosButtonPressedRef.current || voiceDispatchStartedRef.current) return;
    voiceDispatchStartedRef.current = true;
    voiceCaptureActiveRef.current = false;
    if (voiceRecordingTimerRef.current != null) {
      window.clearInterval(voiceRecordingTimerRef.current);
      voiceRecordingTimerRef.current = null;
    }
    if (recognitionRestartTimerRef.current != null) {
      window.clearTimeout(recognitionRestartTimerRef.current);
      recognitionRestartTimerRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {}

    const audio = await stopAudioRecording();
    setIsProcessingVoice(false);
    const transcript = voiceTranscriptRef.current.trim();
    const statement = transcript || (audio
      ? 'Victim voice note recorded. No transcript was available.'
      : 'Emergency SOS triggered. Audio recording was unavailable.');
    await dispatchSOS(statement, audio);
  };

  const handleSOSClick = async () => {
    if (voiceCaptureActiveRef.current || isProcessingVoice || sendingSOS) return;
    sosButtonPressedRef.current = true;
    voiceDispatchStartedRef.current = false;
    speechRecognitionFailedRef.current = false;
    voiceTranscriptRef.current = '';
    setRecordingSecondsRemaining(20);
    setIsProcessingVoice(true);
    setPromptSpoken('Recording and listening for 20 seconds. Describe the emergency and your location.');
    if (!hasGpsFix) {
      acquireLocation();
    }

    voiceCaptureActiveRef.current = true;
    const recorderStartup = startAudioRecording();
    try {
      if (recognitionRef.current) {
        recognitionRef.current.start();
      } else {
        speechRecognitionFailedRef.current = true;
        setPromptSpoken('Speech recognition is not supported here. The voice recording will still be sent.');
      }
    } catch {
      speechRecognitionFailedRef.current = true;
      setPromptSpoken('Automatic transcript unavailable. Voice recording will continue.');
    }

    const recorderStarted = await recorderStartup;
    if (!recorderStarted) {
      setPromptSpoken('Microphone unavailable. SOS will still send after the 20-second countdown.');
    }

    const recordingEndsAt = Date.now() + 20000;
    voiceRecordingTimerRef.current = window.setInterval(() => {
      const secondsRemaining = Math.max(0, Math.ceil((recordingEndsAt - Date.now()) / 1000));
      setRecordingSecondsRemaining(secondsRemaining);
      if (secondsRemaining === 0) void finishVoiceCapture();
    }, 250);
  };

  useEffect(() => {
    if (!reportedIncident) return;

    if (reportedIncident.status === 'RESOLVED') {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const resolvedSpeech = new SpeechSynthesisUtterance('Fire squad has resolved the incident. Stay safe.');
        resolvedSpeech.rate = 0.95;
        resolvedSpeech.lang = 'en-IN';
        window.speechSynthesis.speak(resolvedSpeech);
      }
      return;
    }

    if (!reportedIncident.team) return;
    if (roadRouteSummary === null) return;
    const etaMinutes = roadRouteSummary.etaMinutes;

    if (lastSpokenEtaRef.current !== etaMinutes && 'speechSynthesis' in window) {
      lastSpokenEtaRef.current = etaMinutes;

      const reassuranceMessage = etaMinutes === 0
        ? `Help is on the way. ${reportedIncident.team.name} is at your location.`
        : `Help is on the way. ${reportedIncident.team.name} is estimated to be ${etaMinutes} minutes away by road, without live traffic data.`;
      const speech = new SpeechSynthesisUtterance(reassuranceMessage);
      speech.rate = 0.95;
      speech.lang = 'en-IN';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(speech);
    }
  }, [
    reportedIncident?.status,
    reportedIncident?.team?.id,
    roadRouteSummary?.etaMinutes,
  ]);

  useSubscription<{ incidentStatusUpdated: any }>(ON_INCIDENT_STATUS_UPDATED, {
    onData: ({ data: subData }) => {
      const updated = subData?.data?.incidentStatusUpdated;
      if (reportedIncident && updated && updated.id === reportedIncident.id) {
        setReportedIncident((prev: any) => ({
          ...prev,
          status: updated.status,
          teamId: updated.teamId,
          team: updated.team || prev?.team,
        }));
      }
    },
  });

  useSubscription<{ teamStatusUpdated: any }>(ON_TEAM_STATUS_UPDATED, {
    onData: ({ data: subData }) => {
      const updated = subData?.data?.teamStatusUpdated;
      if (!updated) return;
      setReportedIncident((prev: any) => {
        if (!prev?.team || prev.team.id !== updated.id) return prev;
        return {
          ...prev,
          team: {
            ...prev.team,
            status: updated.status,
            latitude: updated.latitude ?? prev.team.latitude,
            longitude: updated.longitude ?? prev.team.longitude,
          },
        };
      });
    },
  });

  useEffect(() => {
    if (reportedIncident?.status !== 'RESOLVED') return;

    setResolvedCountdown(5);
    const timer = setInterval(() => {
      setResolvedCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setReportedIncident(null);
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [reportedIncident?.status]);

  const handleCallAction = (phone: string) => {
    const cleanNumber = phone ? phone.replace(/[^0-9+]/g, '') : '112';

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(phone).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } else {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = phone;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      } catch {}
    }

    window.location.href = `tel:${cleanNumber}`;
  };

  const truckPosition: [number, number] | null =
    reportedIncident?.team && hasValidCoordinates(reportedIncident.team.latitude, reportedIncident.team.longitude)
      ? [reportedIncident.team.latitude, reportedIncident.team.longitude]
      : null;

  const victimPosition: [number, number] | null = hasValidCoordinates(
    reportedIncident?.latitude,
    reportedIncident?.longitude
  )
    ? [reportedIncident.latitude, reportedIncident.longitude]
    : null;
  const distanceToTruck = roadRouteSummary?.distanceKm ?? null;
  const etaMins = roadRouteSummary?.etaMinutes ?? null;

  if (reportedIncident?.status === 'RESOLVED') {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6 max-w-xl mx-auto flex flex-col justify-between font-sans">
        <header className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-600/20 border border-emerald-500/40 rounded-2xl text-emerald-400">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">FireResQ Emergency</h1>
              <p className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">
                Mission Complete
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold bg-slate-900 border border-slate-700 px-3 py-1 rounded-full text-slate-400">
            Reset in: {resolvedCountdown}s
          </span>
        </header>

        <div className="my-auto py-12 flex flex-col items-center justify-center text-center space-y-6">
          <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-4 border-emerald-500 flex items-center justify-center shadow-[0_0_50px_rgba(16,185,129,0.5)] animate-pulse">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
          </div>

          <h1 className="text-5xl sm:text-6xl font-black text-emerald-400 tracking-wider uppercase drop-shadow-[0_0_35px_rgba(52,211,153,0.6)]">
            STAY SAFE
          </h1>

          <div className="bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-6 max-w-sm space-y-2">
            <p className="text-sm text-slate-200 font-semibold leading-relaxed">
              Fire squad has resolved the incident and secured the scene.
            </p>
            <p className="text-xs text-slate-400">
              Redirecting back to emergency reporting in <strong className="text-emerald-400 font-bold">{resolvedCountdown} seconds</strong>...
            </p>
          </div>

          <button
            onClick={() => {
              setReportedIncident(null);
            }}
            className="mt-4 px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-sm font-black rounded-xl cursor-pointer transition shadow-lg shadow-emerald-600/30 uppercase tracking-wider"
          >
            Report New Incident Now
          </button>
        </div>

        <footer className="pt-4 border-t border-slate-800 text-center text-xs text-slate-500">
          FireResQ Autonomous Emergency Response • Tiptur Central
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 max-w-xl mx-auto flex flex-col justify-between font-sans">
      <header className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-600/20 border border-red-500/40 rounded-xl text-red-500">
            <Flame className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">FireResQ Emergency</h1>
            <p className="text-xs text-slate-400">Direct Citizen Assistance Channel</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full font-bold">
          <Radio className="w-3 h-3 animate-pulse" />
          <span>CONNECTED</span>
        </div>
      </header>

      {!reportedIncident ? (
        <div className="my-auto py-6 flex flex-col items-center text-center space-y-5">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl w-full flex items-start justify-between gap-3 text-left">
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Current Locked Location
                </span>
                <p className="text-xs text-slate-200 font-medium leading-relaxed mt-0.5">
                  {detailedAddress}
                </p>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  {hasGpsFix
                    ? `GPS accuracy ±${Math.round(gpsAccuracyMeters ?? 0)} m · ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                    : gpsMessage}
                </span>
              </div>
            </div>

            <button
              onClick={acquireLocation}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
              title="Refresh GPS Accuracy"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {promptSpoken && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 px-4 py-2 rounded-xl text-xs text-red-300 animate-pulse">
              <Volume2 className="w-4 h-4 shrink-0" />
              <span>{promptSpoken}</span>
            </div>
          )}

          <button
            onClick={handleSOSClick}
            disabled={sendingSOS || isProcessingVoice}
            className="w-64 h-64 sm:w-72 sm:h-72 rounded-full bg-linear-to-br from-red-500 via-red-600 to-red-800 text-white font-black text-3xl shadow-[0_0_60px_rgba(239,68,68,0.45)] hover:shadow-[0_0_80px_rgba(239,68,68,0.7)] active:scale-95 transition-all flex flex-col items-center justify-center gap-2 border-4 border-red-400/40 cursor-pointer disabled:opacity-75"
          >
            <Flame className="w-16 h-16 animate-bounce" />
            <span>
              {isProcessingVoice
                ? `RECORDING ${recordingSecondsRemaining}s`
                : sendingSOS
                  ? 'SENDING...'
                  : 'SOS'}
            </span>
            <span className="text-xs font-medium tracking-widest uppercase text-red-200 mt-1">
              Press For Immediate Help
            </span>
          </button>

          <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
            SOS records your voice for 20 seconds and sends it to the station. GPS is attached when available.
          </p>
        </div>
      ) : (
        <div className="my-auto py-4 space-y-4">
          <div className="bg-red-600/20 border border-red-500/40 p-4 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              <div>
                <h2 className="font-bold text-white text-sm">EMERGENCY REPORT TRANSMITTED</h2>
                <p className="text-xs text-slate-300">
                  {reportedIncident.audioData
                    ? `Victim voice note (${(voiceNoteBytes / 1024).toFixed(0)} KB) attached for the station and assigned squad.`
                    : 'No voice note was attached. Check microphone permission before sending another report.'}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                sosButtonPressedRef.current = false;
                setReportedIncident(null);
              }}
              className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
            >
              New SOS
            </button>
          </div>

          {reportedIncident.team && (
            <div className="bg-slate-900 border border-emerald-500/40 p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="w-5 h-5 text-emerald-400 animate-pulse" />
                  <div>
                    <h3 className="font-bold text-white text-sm">{reportedIncident.team.name}</h3>
                    <p className="text-[11px] text-slate-400">Officer: {reportedIncident.team.leaderName}</p>
                  </div>
                </div>
                <span className="text-xs font-black px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 uppercase">
                  {reportedIncident.status}
                </span>
              </div>

              {roadRouteSummary ? (
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs flex items-center justify-between">
                  <span className="text-slate-400">Road estimate (no live traffic):</span>
                  <span className="text-emerald-400 font-mono font-bold">
                    {etaMins === 0
                      ? 'Squad at destination'
                      : `~${etaMins} min · ${distanceToTruck?.toFixed(1)} km by road`}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-amber-300">
                  Road ETA unavailable until the squad has a valid location and route.
                </p>
              )}
            </div>
          )}

          {victimPosition ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] px-1 font-semibold">
                <span className="flex items-center gap-1.5 text-red-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shadow-[0_0_8px_#ef4444]" />
                  Your Spot (🔥 Incident)
                </span>
                {reportedIncident.team && (
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block shadow-[0_0_8px_#3b82f6]" />
                    Remaining Driving Route
                  </span>
                )}
              </div>

              <div className="h-64 w-full rounded-2xl overflow-hidden border border-slate-800 relative z-0">
                <MapContainer
                  center={victimPosition}
                  zoom={15}
                  scrollWheelZoom={false}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  <MapBoundsAdjuster
                    victimPos={victimPosition}
                    truckPos={truckPosition}
                  />

                  {activeRemainingRoute.length > 1 && (
                    <Polyline
                      positions={activeRemainingRoute}
                      color="#2563eb"
                      weight={6}
                      opacity={0.9}
                    />
                  )}

                  {/* FIRE INCIDENT MARKER WITH HOVER TOOLTIP & DETAILED POPUP */}
                  {leafletIcons && <Marker position={victimPosition} icon={leafletIcons.victimIcon}>
                    <Tooltip permanent direction="top" offset={[0, -20]}>
                      <div className="font-bold text-xs text-red-600 flex items-center gap-1">
                        🔥 Incident Site
                      </div>
                    </Tooltip>
                    <Popup autoPan>
                      <div className="p-1 text-slate-900">
                        <div className="font-black text-xs text-red-600 uppercase">🔥 Your Emergency Location</div>
                        <div className="text-xs font-semibold mt-0.5">{reportedIncident.location || detailedAddress}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-1">
                          Coords: {victimPosition[0].toFixed(5)}, {victimPosition[1].toFixed(5)}
                        </div>
                      </div>
                    </Popup>
                  </Marker>}

                  {/* RESPONDING TRUCK MARKER WITH LIVE POSITION & ETA TOOLTIP */}
                  {truckPosition && leafletIcons && (
                    <Marker position={truckPosition} icon={leafletIcons.teamIcon}>
                      <Tooltip permanent direction="top" offset={[0, -22]}>
                        <div className="font-bold text-xs text-emerald-700 flex items-center gap-1">
                          🚒 {reportedIncident.team.name}
                        </div>
                      </Tooltip>
                      <Popup autoPan>
                        <div className="p-1 text-slate-900">
                          <div className="font-black text-xs text-emerald-700 uppercase">
                            🚒 Unit: {reportedIncident.team.name}
                          </div>
                          <div className="text-xs text-slate-700 mt-0.5">
                            Leader: {reportedIncident.team.leaderName}
                          </div>
                          <div className="text-xs font-mono font-bold text-emerald-600 mt-1">
                            Phone: {reportedIncident.team.phone}
                          </div>
                          {etaMins && (
                            <div className="text-[11px] font-bold text-blue-600 mt-0.5">
                              ETA: ~{etaMins} min · {distanceToTruck?.toFixed(1)} km by road, no live traffic
                            </div>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              </div>
            </div>
          ) : reportedIncident ? (
            <p className="text-xs text-amber-300">Incident GPS coordinates are unavailable, so the map cannot locate the emergency.</p>
          ) : null}

          {reportedIncident.team ? (
            <div className="bg-linear-to-br from-slate-900 to-slate-950 border-2 border-emerald-500/50 p-5 rounded-2xl space-y-4 shadow-xl">
              <button
                onClick={() => handleCallAction(reportedIncident.team.phone)}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold text-base rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition cursor-pointer"
              >
                <Phone className="w-5 h-5 animate-bounce" />
                <span>
                  {copied
                    ? 'COPIED! OPENING DIALER...'
                    : `CALL SQUAD: ${reportedIncident.team.phone}`}
                </span>
              </button>

              <div className="flex items-center justify-between bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400">Direct Contact:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-emerald-400 text-sm">
                    {reportedIncident.team.phone}
                  </span>
                  <button
                    onClick={() => handleCallAction(reportedIncident.team.phone)}
                    className="p-1 hover:text-white text-slate-400 transition cursor-pointer"
                    title="Copy & Call"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-amber-500/30 p-5 rounded-2xl text-center space-y-2">
              <Truck className="w-8 h-8 text-amber-400 mx-auto animate-pulse" />
              <h3 className="text-white font-bold text-sm">Station Evaluating Situation...</h3>
              <p className="text-xs text-slate-400">
                The control room has your GPS and audio details. Stand by for squad dispatch.
              </p>
            </div>
          )}

          <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl text-xs space-y-1">
            <span className="text-slate-400 block font-semibold uppercase tracking-wider text-[10px]">
              Transmitted Landmark
            </span>
            <p className="text-slate-200 font-medium leading-relaxed">
              {reportedIncident.location || detailedAddress}
            </p>
          </div>
        </div>
      )}

      <footer className="pt-4 border-t border-slate-800 text-center text-xs text-slate-500">
        FireResQ Autonomous Emergency Response • Tiptur Central
      </footer>
    </div>
  );
}