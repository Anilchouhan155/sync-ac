import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wind,
  Bell,
  ChevronRight,
  Zap,
  CheckCircle2,
  AlertTriangle,
  BedDouble,
} from 'lucide-react';
import {
  onSnapshot,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  addDoc,
  deleteDoc,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { auth, db, signInFrictionless, handleFirestoreError } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { cn } from './lib/utils';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function formatLogTime(ts: Timestamp): string {
  const date = ts.toDate();
  const istTime = date.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).replace('am', 'AM').replace('pm', 'PM');

  const now = new Date();
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const istDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

  const isToday = istDate.toDateString() === istNow.toDateString();
  const yesterday = new Date(istNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = istDate.toDateString() === yesterday.toDateString();

  if (isToday) return `at ${istTime} today`;
  if (isYesterday) return `at ${istTime} yesterday`;
  return `on ${istDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' })} at ${istTime}`;
}

// Types
interface UserProfile {
  name: string;
  flatId: string;
  room: string;
}

interface RoomState {
  status: 'on' | 'off';
  updatedBy: string;
  updatedByName: string;
  updatedAt: any;
}

interface ActivityLog {
  id: string;
  roomName: string;
  status: 'on' | 'off';
  updatedByName: string;
  updatedAt: Timestamp;
}

interface CoordRequest {
  id: string;
  fromUid: string;
  fromName: string;
  fromRoom: string;
  createdAt: Timestamp;
  expireAt: Timestamp;
}

const SOUNDS = [
  { file: '/mixkit-slot-machine-win-alert-1931.wav', label: 'Slot Machine' },
  { file: '/apebble-fart.mp3',      label: 'Fart'         },
  { file: '/dragon-studio-thud.mp3', label: 'Thud'        },
  { file: '/fackkk.mp3',            label: 'Fack'         },
  { file: '/goofy-car-horn.mp3',    label: 'Car Horn'     },
  { file: '/hehe-boy.mp3',          label: 'Hehe'         },
  { file: '/isnt-that-amazing.mp3', label: 'Amazing'      },
  { file: '/sinister-laugh.mp3',    label: 'Sinister'     },
  { file: '/watch-yo-jet-bro.mp3',  label: 'Watch Yo Jet' },
  { file: '/what-meme.mp3',         label: 'What?'        },
];

const OFF_SOUNDS = [
  { file: '/confirm-accept.mp3',       label: 'Accept'      },
  { file: '/confirm-affirmative.mp3',  label: 'Affirmative' },
  { file: '/confirm-miraclei.mp3',     label: 'Miracle'     },
  { file: '/confirm-universfield.mp3', label: 'Universal'   },
];

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isChromeOnIOS = isIOS && /CriOS/.test(navigator.userAgent);
const supportsPush = 'PushManager' in window && !isChromeOnIOS;

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [rooms, setRooms] = useState<Record<string, RoomState>>({});
  const [currentTab, setCurrentTab] = useState<'home' | 'settings'>('home');
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [flatmates, setFlatmates] = useState<Record<string, string>>({}); // roomName → userName
  const [flatType, setFlatType] = useState<'2 BHK' | '3 BHK'>('2 BHK');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('ac-sound-enabled');
    return saved === null ? true : saved === 'true';
  });
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  const [selectedSound, setSelectedSound] = useState(
    () => localStorage.getItem('ac-selected-sound') ?? SOUNDS[0].file
  );
  const selectedSoundRef = useRef(selectedSound);
  useEffect(() => { selectedSoundRef.current = selectedSound; }, [selectedSound]);

  const [offSoundEnabled, setOffSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('ac-off-sound-enabled');
    return saved === null ? true : saved === 'true';
  });
  const offSoundEnabledRef = useRef(offSoundEnabled);
  useEffect(() => { offSoundEnabledRef.current = offSoundEnabled; }, [offSoundEnabled]);

  const [selectedOffSound, setSelectedOffSound] = useState(
    () => localStorage.getItem('ac-off-selected-sound') ?? OFF_SOUNDS[1].file
  );
  const selectedOffSoundRef = useRef(selectedOffSound);
  useEffect(() => { selectedOffSoundRef.current = selectedOffSound; }, [selectedOffSound]);

  const [changingRoom, setChangingRoom] = useState(false);
  const [requests, setRequests] = useState<CoordRequest[]>([]);
  const [highLoadRemaining, setHighLoadRemaining] = useState<number | null>(null);
  const highLoadStartRef = useRef<number | null>(null);
  const explosionPlayedRef = useRef(false);
  const prevRoomsRef = useRef<Record<string, RoomState>>({});

  // Onboarding Form State
  const [form, setForm] = useState({
    flatNumber: '',
    flatType: '2 BHK' as '2 BHK' | '3 BHK',
    room: '',
    userName: '',
  });

  // PWA install prompt
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches || !!(navigator as any).standalone
  );

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setDeferredInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setIsAppInstalled(true));
    return () => { window.removeEventListener('beforeinstallprompt', handler); };
  }, []);

  // ── Push helpers ────────────────────────────────────────────────────────────

  const subscribeToPush = async (uid: string) => {
    if (!supportsPush) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      await setDoc(doc(db, 'users', uid), { pushSubscription: sub.toJSON() }, { merge: true });
    } catch (e) {
      console.warn('Push subscription failed', e);
    }
  };

  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      localStorage.setItem('ac-sound-enabled', String(next));
      return next;
    });
  };

  const sendPushToFlatmates = async (flatId: string, senderUid: string, roomName: string, status: string) => {
    try {
      const usersSnap = await getDocs(query(collection(db, 'users'), where('flatId', '==', flatId)));
      const subscriptions = usersSnap.docs
        .filter((d) => d.id !== senderUid && d.data().pushSubscription)
        .map((d) => d.data().pushSubscription);
      if (!subscriptions.length) return;
      const name = profile?.name ?? 'Someone';
      await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptions,
          title: 'AC Sync',
          body: `${name} turned ${status === 'on' ? 'ON' : 'OFF'} AC in ${roomName}`,
        }),
      });
    } catch (e) {
      console.warn('Push send failed', e);
    }
  };

  // ── Effects ─────────────────────────────────────────────────────────────────

  // 1. Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(true);
        try {
          await signInFrictionless();
        } catch (e: any) {
          if (e.code === 'auth/admin-restricted-operation') {
            alert('Enable Anonymous Authentication in Firebase Console.');
          }
        }
      } else {
        setUser(u);
        try {
          const profileDoc = await getDoc(doc(db, 'users', u.uid));
          if (profileDoc.exists()) {
            const p = profileDoc.data() as UserProfile;
            setProfile(p);

            // Check existing push subscription
            if (supportsPush && Notification.permission === 'granted') {
              await subscribeToPush(u.uid);
            }
          }
        } catch (e) {
          console.error('Profile load failed', e);
        }
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Rooms listener
  useEffect(() => {
    if (!profile || !user) return;
    prevRoomsRef.current = {};
    const roomsRef = collection(db, 'flats', profile.flatId, 'rooms');
    const unsubscribe = onSnapshot(roomsRef, (snapshot) => {
      const state: Record<string, RoomState> = {};
      snapshot.forEach((d) => { state[d.id] = d.data() as RoomState; });

      // Compare against last known state — only react when status truly flips
      Object.entries(state).forEach(([roomName, room]) => {
        const prev = prevRoomsRef.current[roomName];
        const statusChanged = prev && prev.status !== room.status;
        const byOther = room.updatedBy !== user.uid;

        if (statusChanged && byOther) {
          if (room.status === 'on') {
            // Read directly from localStorage — no stale ref possible
            const enabled = localStorage.getItem('ac-sound-enabled') !== 'false';
            const file = localStorage.getItem('ac-selected-sound') ?? SOUNDS[0].file;
            if (enabled) new Audio(file).play().catch(() => {});
            sendPushToFlatmates(profile.flatId, user.uid, roomName, room.status);
          } else {
            const enabled = localStorage.getItem('ac-off-sound-enabled') === 'true';
            const file = localStorage.getItem('ac-off-selected-sound') ?? OFF_SOUNDS[0].file;
            if (enabled) new Audio(file).play().catch(() => {});
          }
        }
      });

      prevRoomsRef.current = state;
      setRooms(state);
    });
    return () => unsubscribe();
  }, [profile, user]);

  // 3. Activity log (flat-specific, latest 5, IST)
  useEffect(() => {
    if (!profile) return;
    const q = query(
      collection(db, 'flats', profile.flatId, 'logs'),
      orderBy('updatedAt', 'desc'),
      limit(5)
    );
    return onSnapshot(q, (snap) => {
      setActivityLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLog)));
    });
  }, [profile]);

  // 4. Flatmates listener — maps roomName → userName for room cards
  useEffect(() => {
    if (!profile) return;
    const q = query(collection(db, 'users'), where('flatId', '==', profile.flatId));
    return onSnapshot(q, (snap) => {
      const map: Record<string, string> = {};
      snap.forEach((d) => {
        const data = d.data() as UserProfile;
        if (data.room) map[data.room] = data.name;
      });
      setFlatmates(map);
    });
  }, [profile]);

  // 5. Load flat type for Change Room options
  useEffect(() => {
    if (!profile) return;
    getDoc(doc(db, 'flats', profile.flatId)).then((d) => {
      if (d.exists()) setFlatType(d.data().type ?? '2 BHK');
    });
  }, [profile]);

  // 6. Coordination requests listener
  useEffect(() => {
    if (!profile) return;
    const q = query(
      collection(db, 'flats', profile.flatId, 'requests'),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snap) => {
      setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CoordRequest)));
    });
  }, [profile]);

  // 7. High load countdown timer — starts when >1 AC on, explodes at 0
  useEffect(() => {
    const active = Object.values(rooms).filter((r) => r.status === 'on').length;
    if (active > 1) {
      if (highLoadStartRef.current === null) {
        highLoadStartRef.current = Date.now();
        explosionPlayedRef.current = false;
      }
      const id = setInterval(() => {
        const elapsed = Math.floor((Date.now() - highLoadStartRef.current!) / 1000);
        const remaining = Math.max(0, 300 - elapsed);
        setHighLoadRemaining(remaining);
        if (remaining === 0 && !explosionPlayedRef.current) {
          explosionPlayedRef.current = true;
          new Audio('/fackkk.mp3').play().catch(() => {});
        }
      }, 1000);
      return () => clearInterval(id);
    } else {
      highLoadStartRef.current = null;
      explosionPlayedRef.current = false;
      setHighLoadRemaining(null);
    }
  }, [rooms]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleOnboarding = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const flatId = `flat_${form.flatNumber.toLowerCase().replace(/\s+/g, '_')}`;
      const newProfile: UserProfile = { name: form.userName, flatId, room: form.room };
      await setDoc(doc(db, 'users', user.uid), newProfile);

      const flatRef = doc(db, 'flats', flatId);
      const flatDoc = await getDoc(flatRef);
      if (!flatDoc.exists()) {
        await setDoc(flatRef, { number: form.flatNumber, type: form.flatType });
        const roomsToCreate = form.flatType === '2 BHK' ? ['Room A', 'Room B'] : ['Room A', 'Room B', 'Room C'];
        const batch = writeBatch(db);
        roomsToCreate.forEach((r) => {
          batch.set(doc(db, 'flats', flatId, 'rooms', r), {
            status: 'off', updatedBy: 'system', updatedByName: 'System', updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      setProfile(newProfile);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeRoom = async (newRoom: string) => {
    if (!user || !profile) return;
    const updated = { ...profile, room: newRoom };
    await setDoc(doc(db, 'users', user.uid), updated);
    setProfile(updated);
    setChangingRoom(false);
  };

  const toggleAC = async (roomName: string, currentStatus: 'on' | 'off') => {
    if (!profile || !user) return;
    const newStatus = currentStatus === 'on' ? 'off' : 'on';
    try {
      await setDoc(doc(db, 'flats', profile.flatId, 'rooms', roomName), {
        status: newStatus, updatedBy: user.uid, updatedByName: profile.name, updatedAt: serverTimestamp(),
      }, { merge: true });

      await addDoc(collection(db, 'flats', profile.flatId, 'logs'), {
        roomName, status: newStatus, updatedBy: user.uid, updatedByName: profile.name, updatedAt: serverTimestamp(),
      });

      // If turning ON while others are already on → send coordination request
      if (newStatus === 'on') {
        const othersOn = Object.entries(rooms).some(([rName, rState]) =>
          rName !== roomName && rState.status === 'on'
        );
        if (othersOn) {
          await addDoc(collection(db, 'flats', profile.flatId, 'requests'), {
            fromUid: user.uid,
            fromName: profile.name,
            fromRoom: roomName,
            createdAt: serverTimestamp(),
            expireAt: Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000)),
          });
        }
      }
    } catch (e) {
      handleFirestoreError(e, 'update');
    }
  };

  const respondToRequest = async (requestId: string, turnOff: boolean) => {
    if (!profile || !user) return;
    if (turnOff) {
      await setDoc(doc(db, 'flats', profile.flatId, 'rooms', profile.room), {
        status: 'off', updatedBy: user.uid, updatedByName: profile.name, updatedAt: serverTimestamp(),
      }, { merge: true });
      await addDoc(collection(db, 'flats', profile.flatId, 'logs'), {
        roomName: profile.room, status: 'off', updatedBy: user.uid, updatedByName: profile.name, updatedAt: serverTimestamp(),
      });
    }
    await deleteDoc(doc(db, 'flats', profile.flatId, 'requests', requestId));
  };

  const handleResetSession = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Delete Firestore profile
      await deleteDoc(doc(db, 'users', user.uid));

      // Clear all browser storage
      localStorage.clear();
      sessionStorage.clear();

      // Clear all SW caches
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }

      // Reload so the SW re-registers clean and the app starts fresh
      window.location.reload();
    } catch (e) {
      console.error('Reset failed', e);
      setLoading(false);
    }
  };

  if (loading) return <LoadingScreen />;

  // ── Onboarding ───────────────────────────────────────────────────────────────

  if (!profile) {
    const iosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const iosSafari = iosDevice && /safari/i.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
    const iosChrome = iosDevice && /CriOS/.test(navigator.userAgent);
    const showInstallBanner = !isAppInstalled;

    const handleInstall = async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') { setIsAppInstalled(true); setDeferredInstallPrompt(null); }
    };

    return (
      <div className="min-h-screen bg-[#F4F4F7] font-sans text-[#1A1A1A] flex flex-col">
        <div className="max-w-md mx-auto w-full flex-1 flex flex-col p-6 pt-10 pb-36">

          {/* Header */}
          <header className="mb-8">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100 mb-5">
              <Wind className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-neutral-900">AC Sync</h1>
            <p className="text-neutral-500 font-medium mt-1">Coordinate AC with your flatmates — in real time.</p>
          </header>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            <div className="h-1.5 flex-1 rounded-full bg-indigo-600" />
            <div className={cn('h-1.5 flex-1 rounded-full transition-colors', onboardingStep === 1 ? 'bg-indigo-600' : 'bg-neutral-200')} />
            <span className="text-xs font-bold text-neutral-400 ml-1">Step {onboardingStep + 1} of 2</span>
          </div>

          <AnimatePresence mode="wait">
            {onboardingStep === 0 && (
              <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div className="bg-white rounded-[2rem] p-7 shadow-sm border border-neutral-200 space-y-5">
                  <div>
                    <p className="text-lg font-black text-neutral-900">Which flat do you live in?</p>
                    <p className="text-sm text-neutral-400 mt-1">Flatmates who enter the same flat number will be connected automatically.</p>
                  </div>
                  <input
                    placeholder="Flat number (e.g. 402, B-12)"
                    className="w-full bg-neutral-50 border border-neutral-200 p-4 rounded-2xl outline-none focus:border-indigo-500 transition-colors text-base"
                    value={form.flatNumber}
                    onChange={(e) => setForm({ ...form, flatNumber: e.target.value })}
                  />
                  <div>
                    <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3">How many bedrooms?</p>
                    <div className="flex gap-2">
                      {([['2 BHK', '2 rooms'], ['3 BHK', '3 rooms']] as const).map(([t, sub]) => (
                        <button key={t} onClick={() => setForm({ ...form, flatType: t })}
                          className={cn('flex-1 py-4 rounded-2xl border font-bold transition-all flex flex-col items-center gap-0.5',
                            form.flatType === t ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border-neutral-200 text-neutral-600')}>
                          <span className="text-base font-black">{t}</span>
                          <span className={cn('text-xs font-medium', form.flatType === t ? 'text-indigo-200' : 'text-neutral-400')}>{sub}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button disabled={!form.flatNumber.trim()} onClick={() => setOnboardingStep(1)}
                  className="w-full bg-neutral-900 text-white py-5 rounded-[2rem] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-40">
                  Continue <ChevronRight className="w-5 h-5" />
                </button>
              </motion.div>
            )}

            {onboardingStep === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div className="bg-white rounded-[2rem] p-7 shadow-sm border border-neutral-200 space-y-5">
                  <div>
                    <p className="text-lg font-black text-neutral-900">Tell us who you are</p>
                    <p className="text-sm text-neutral-400 mt-1">Your flatmates will see your name when you turn the AC on or off.</p>
                  </div>
                  <input
                    placeholder="Your name (e.g. Anil)"
                    className="w-full bg-neutral-50 border border-neutral-200 p-4 rounded-2xl outline-none focus:border-indigo-500 transition-colors text-base"
                    value={form.userName}
                    onChange={(e) => setForm({ ...form, userName: e.target.value })}
                  />
                  <div>
                    <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3">Which room is yours?</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(form.flatType === '2 BHK' ? ['Room A', 'Room B'] : ['Room A', 'Room B', 'Room C']).map((r) => (
                        <button key={r} onClick={() => setForm({ ...form, room: r })}
                          className={cn('p-4 rounded-2xl border font-bold transition-all flex items-center gap-2',
                            form.room === r ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border-neutral-200 text-neutral-600')}>
                          <BedDouble className="w-4 h-4 shrink-0" /> {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setOnboardingStep(0)}
                    className="px-6 py-5 rounded-[2rem] border border-neutral-200 bg-white font-bold text-neutral-600 active:scale-95 transition-all">
                    Back
                  </button>
                  <button disabled={!form.userName.trim() || !form.room} onClick={handleOnboarding}
                    className="flex-1 bg-indigo-600 text-white py-5 rounded-[2rem] font-bold shadow-xl shadow-indigo-100 active:scale-95 transition-all disabled:opacity-40">
                    Start Syncing
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* PWA Install Banner */}
        {showInstallBanner && (
          <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-neutral-200 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
            <div className="max-w-md mx-auto">
              {deferredInstallPrompt ? (
                /* Android / Desktop Chrome — native prompt available */
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
                    <Wind className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-neutral-900">Download as App (PWA)</p>
                    <p className="text-xs text-neutral-400">Works offline, no app store needed</p>
                  </div>
                  <button onClick={handleInstall}
                    className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm shrink-0 active:scale-95 transition-all shadow-lg shadow-indigo-100">
                    Install
                  </button>
                </div>
              ) : iosSafari ? (
                /* iOS Safari — manual install */
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
                    <Wind className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-neutral-900">Add to Home Screen (PWA)</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Tap <span className="font-bold text-neutral-700">Share</span> <span className="text-base leading-none">⎙</span> at the bottom of Safari → then tap <span className="font-bold text-neutral-700">"Add to Home Screen"</span>
                    </p>
                  </div>
                </div>
              ) : iosChrome ? (
                /* iOS Chrome — redirect to Safari */
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center text-white shrink-0">
                    <Bell className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-neutral-900">Open in Safari to Install as App</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Chrome on iPhone doesn't support PWA install. Copy the URL and open it in <span className="font-bold text-neutral-700">Safari</span> instead.</p>
                  </div>
                </div>
              ) : (
                /* Already installed or unsupported */
                null
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────

  const activeRooms = Object.values(rooms).filter((r) => r.status === 'on').length;
  const availableRooms = flatType === '2 BHK' ? ['Room A', 'Room B'] : ['Room A', 'Room B', 'Room C'];

  return (
    <div className="min-h-screen bg-[#F4F4F7] font-sans text-[#1A1A1A]">
      <div className="max-w-md mx-auto p-5 pb-10 h-full flex flex-col gap-4">

        {currentTab === 'home' ? (
          <>
            {/* Header */}
            <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-neutral-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
                  <Wind className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black tracking-tight">{profile.flatId.split('_').slice(1).join(' ').toUpperCase()}</h2>
                  <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400 leading-none">Flat Management</p>
                </div>
              </div>
              <button onClick={() => setCurrentTab('settings')} className="cursor-pointer transition-transform active:scale-90">
                <div className="w-9 h-9 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center text-sm font-bold text-indigo-600 uppercase shadow-sm">
                  {profile.name[0]}
                </div>
              </button>
            </div>

            {/* Coordination Request Banner */}
            {requests.filter((r) => r.fromUid !== user?.uid).map((req) => (
              <motion.div key={req.id}
                initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white border-2 border-indigo-200 rounded-[2rem] p-6 shadow-xl shadow-indigo-100">
                <p className="text-sm font-black text-neutral-900 leading-snug mb-4">
                  🔔 <span className="text-indigo-600">{req.fromName}</span> just turned on AC. Want to turn yours off?
                </p>
                <div className="flex gap-3">
                  <button onClick={() => respondToRequest(req.id, true)}
                    className="flex-1 bg-indigo-600 text-white py-3 rounded-2xl font-black text-sm active:scale-95 transition-all shadow-lg shadow-indigo-100">
                    hmm... okay 😮‍💨
                  </button>
                  <button onClick={() => respondToRequest(req.id, false)}
                    className="flex-1 bg-neutral-100 text-neutral-700 py-3 rounded-2xl font-black text-sm active:scale-95 transition-all">
                    Keep Mine On 🙄
                  </button>
                </div>
              </motion.div>
            ))}

            {/* Global Summary */}
            <div className={cn('rounded-[2rem] p-6 shadow-sm flex flex-col justify-center transition-all duration-700',
              activeRooms > 1 ? 'bg-orange-50 border border-orange-100' : 'bg-indigo-600 border border-indigo-600 shadow-xl shadow-indigo-100')}>
              <div className="flex items-center justify-between mb-2">
                <div className={cn('p-2 rounded-lg', activeRooms > 1 ? 'bg-orange-100 text-orange-600' : 'bg-indigo-500 text-white')}>
                  {activeRooms > 1 ? <AlertTriangle className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                </div>
                <span className={cn('text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg',
                  activeRooms > 1 ? 'bg-orange-100 text-orange-600' : 'bg-indigo-500 text-indigo-100')}>
                  {activeRooms > 1 ? 'High Load' : 'Optimal'}
                </span>
              </div>
              <p className={cn('text-4xl font-black tracking-tighter', activeRooms > 1 ? 'text-orange-900' : 'text-white')}>
                {activeRooms} <span className="text-xl font-bold opacity-60">Active ACs</span>
              </p>
              {activeRooms > 1 && highLoadRemaining !== null && (
                <div className="mt-3">
                  <p className="text-xs text-orange-700 font-bold">Coordinate with flatmates!</p>
                  {highLoadRemaining > 0 ? (
                    <p className="text-xs font-black text-orange-500 mt-1 tabular-nums">
                      💥 explodes in {Math.floor(highLoadRemaining / 60)}:{String(highLoadRemaining % 60).padStart(2, '0')}
                    </p>
                  ) : (
                    <p className="text-xs font-black text-red-600 mt-1 animate-pulse">💥 TIME'S UP!</p>
                  )}
                </div>
              )}
            </div>

            {/* Room Grid */}
            <div className="grid grid-cols-2 gap-4">
              {(Object.entries(rooms) as [string, RoomState][]).map(([name, state]) => {
                const occupant = flatmates[name];
                const isMyRoom = name === profile.room;
                return (
                  <div key={name} className={cn(
                    'rounded-[2.5rem] p-6 flex flex-col justify-between transition-all duration-500 border h-52',
                    state.status === 'on' ? 'bg-white border-indigo-200 shadow-xl shadow-indigo-100' : 'bg-white border-neutral-200 shadow-sm opacity-60'
                  )}>
                    <div className="flex flex-col">
                      <div className="flex justify-between items-start">
                        <span className={cn('text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded',
                          state.status === 'on' ? 'bg-indigo-100 text-indigo-600' : 'bg-neutral-100 text-neutral-400')}>
                          {isMyRoom ? 'MY ROOM' : occupant ? occupant.toUpperCase() : 'FLATMATE'}
                        </span>
                        <div className={cn('w-2 h-2 rounded-full',
                          state.status === 'on' ? 'bg-green-500 animate-pulse ring-4 ring-green-500/20' : 'bg-neutral-300')} />
                      </div>
                      <h4 className="text-xl font-black mt-3 leading-tight text-neutral-900">{name}</h4>
                      {state.status === 'on' ? (
                        <div className="mt-1">
                          <p className="text-[10px] text-neutral-400 font-bold uppercase">By {state.updatedByName}</p>
                          <p className="text-xs font-black text-indigo-500 mt-0.5 tabular-nums">
                            ⏱ <LiveTimer since={state.updatedAt} />
                          </p>
                        </div>
                      ) : (
                        <p className="text-[10px] text-neutral-400 font-bold mt-1 uppercase">Standby</p>
                      )}
                    </div>
                    <button
                      onClick={() => isMyRoom && toggleAC(name, state.status)}
                      disabled={!isMyRoom}
                      className={cn('w-full py-4 rounded-2xl font-black text-[10px] tracking-widest transition-all shadow-sm',
                        isMyRoom
                          ? cn('cursor-pointer active:scale-95', state.status === 'on' ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200')
                          : 'cursor-not-allowed bg-neutral-100 text-neutral-300')}>
                      {isMyRoom ? (state.status === 'on' ? 'SHUT OFF' : 'TURN ON') : 'NOT YOUR ROOM'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Activity Log */}
            <div className="bg-[#1A1A1A] rounded-[2.5rem] p-8 text-white mt-2 mb-4">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black tracking-tight">Activity Log</h3>
                <Bell className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="space-y-5">
                {activityLogs.length === 0 && (
                  <p className="text-sm text-neutral-500 italic text-center py-4">No activity yet.</p>
                )}
                {activityLogs.map((log) => (
                  <div key={log.id} className="border-l-2 border-indigo-500 pl-4 py-1">
                    <p className="text-sm font-medium leading-snug">
                      <span className="text-white font-black">{log.updatedByName}</span>
                      {' turned '}
                      <span className={cn('font-black', log.status === 'on' ? 'text-green-400' : 'text-red-400')}>
                        {log.status === 'on' ? 'ON' : 'OFF'}
                      </span>
                      {' AC in '}
                      <span className="text-indigo-400 font-bold">{log.roomName}</span>
                    </p>
                    <p className="text-[10px] text-neutral-500 font-bold mt-0.5 uppercase tracking-widest">
                      {log.updatedAt ? formatLogTime(log.updatedAt) : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* ── Settings ─────────────────────────────────────────────────── */
          <div className="space-y-6 pt-4">
            <div className="flex items-center gap-4 mb-4">
              <button onClick={() => { setCurrentTab('home'); setChangingRoom(false); }}
                className="w-10 h-10 bg-white border border-neutral-200 rounded-xl flex items-center justify-center text-neutral-400 hover:text-indigo-600 transition-colors cursor-pointer">
                <ChevronRight className="w-5 h-5 rotate-180" />
              </button>
              <h1 className="text-2xl font-black tracking-tight text-neutral-900">Settings</h1>
            </div>

            {/* Profile Card */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-neutral-200">
              <h3 className="text-xl font-black tracking-tight mb-6">Your Profile</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-4 bg-neutral-50 rounded-2xl">
                  <span className="text-sm font-bold text-neutral-500">Name</span>
                  <span className="font-bold">{profile.name}</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-neutral-50 rounded-2xl">
                  <span className="text-sm font-bold text-neutral-500">Flat</span>
                  <span className="font-bold">{profile.flatId.split('_').slice(1).join(' ').toUpperCase()}</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-neutral-50 rounded-2xl">
                  <span className="text-sm font-bold text-neutral-500">My Room</span>
                  <span className="font-bold">{profile.room}</span>
                </div>
              </div>
            </div>

            {/* Notifications */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-neutral-200 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black tracking-tight">Notifications</h3>
                  <p className="text-xs text-neutral-400 font-medium mt-1">Alert when AC status changes</p>
                </div>
                <Bell className="w-5 h-5 text-indigo-400" />
              </div>

              {/* Sound toggle */}
              <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-2xl">
                <div>
                  <p className="text-sm font-bold text-neutral-700">Sound Alert</p>
                  <p className="text-[10px] text-neutral-400 font-medium mt-0.5">Play sound when flatmate Turn On AC</p>
                </div>
                <button onClick={toggleSound}
                  className={cn('relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none cursor-pointer',
                    soundEnabled ? 'bg-indigo-600' : 'bg-neutral-300')}>
                  <span className={cn('absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300',
                    soundEnabled ? 'translate-x-6' : 'translate-x-0')} />
                </button>
              </div>

              {/* Sound picker — only when sound is enabled */}
              {soundEnabled && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-3">Choose Alert Sound</p>
                  <div className="grid grid-cols-2 gap-2">
                    {SOUNDS.map((s) => {
                      const isSelected = selectedSound === s.file;
                      return (
                        <button key={s.file}
                          onClick={() => {
                            setSelectedSound(s.file);
                            localStorage.setItem('ac-selected-sound', s.file);
                            new Audio(s.file).play().catch(() => {});
                          }}
                          className={cn(
                            'p-3 rounded-2xl border text-xs font-black transition-all active:scale-95 text-left',
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100'
                              : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:border-indigo-300'
                          )}>
                          <span className="block truncate">{s.label}</span>
                          {isSelected && <span className="block text-[9px] opacity-70 mt-0.5">▶ SELECTED</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Push notification status */}
              {isChromeOnIOS ? (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                  <p className="text-xs font-bold text-amber-700 leading-relaxed">
                    Background push not supported in Chrome on iPhone.{' '}
                    <span className="underline">Open in Safari</span> → Share → Add to Home Screen.
                  </p>
                </div>
              ) : Notification.permission === 'denied' ? (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
                  <p className="text-xs font-bold text-red-600 leading-relaxed">
                    Background alerts blocked. Go to browser Settings → Notifications → allow this site.
                  </p>
                </div>
              ) : Notification.permission === 'granted' ? (
                <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-2xl p-4">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <p className="text-xs font-bold text-green-700">Background alerts enabled — you'll be notified even when the app is closed.</p>
                </div>
              ) : (
                <button onClick={async () => {
                  const perm = await Notification.requestPermission();
                  if (perm === 'granted' && user) await subscribeToPush(user.uid);
                }}
                  className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                  <Bell className="w-4 h-4" /> Enable Background Alerts
                </button>
              )}
            </div>

            {/* AC Turned OFF Alerts */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-neutral-200 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black tracking-tight">AC Turned OFF Alert</h3>
                  <p className="text-xs text-neutral-400 font-medium mt-1">Get notified when a flatmate turns off their AC</p>
                </div>
                <Bell className="w-5 h-5 text-green-500" />
              </div>

              <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-2xl">
                <div>
                  <p className="text-sm font-bold text-neutral-700">Sound Alert</p>
                  <p className="text-[10px] text-neutral-400 font-medium mt-0.5">Play sound when flatmate turns off AC</p>
                </div>
                <button
                  onClick={() => setOffSoundEnabled(prev => {
                    const next = !prev;
                    localStorage.setItem('ac-off-sound-enabled', String(next));
                    return next;
                  })}
                  className={cn('relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none cursor-pointer',
                    offSoundEnabled ? 'bg-green-500' : 'bg-neutral-300')}>
                  <span className={cn('absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300',
                    offSoundEnabled ? 'translate-x-6' : 'translate-x-0')} />
                </button>
              </div>

              {offSoundEnabled && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-3">Choose Alert Sound</p>
                  <div className="grid grid-cols-2 gap-2">
                    {OFF_SOUNDS.map((s) => {
                      const isSelected = selectedOffSound === s.file;
                      return (
                        <button key={s.file}
                          onClick={() => {
                            setSelectedOffSound(s.file);
                            localStorage.setItem('ac-off-selected-sound', s.file);
                            new Audio(s.file).play().catch(() => {});
                          }}
                          className={cn(
                            'p-3 rounded-2xl border text-xs font-black transition-all active:scale-95 text-left',
                            isSelected
                              ? 'bg-green-500 border-green-500 text-white shadow-lg shadow-green-100'
                              : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:border-green-300'
                          )}>
                          <span className="block truncate">{s.label}</span>
                          {isSelected && <span className="block text-[9px] opacity-70 mt-0.5">▶ SELECTED</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Reset Session */}
            <button onClick={handleResetSession}
              className="w-full bg-orange-50 text-orange-600 p-5 rounded-[2rem] font-black flex items-center justify-center gap-3 transition-all active:scale-95 border border-orange-100 cursor-pointer">
              Reset & Re-onboard
            </button>
            <p className="text-center text-xs text-neutral-400 font-medium px-8 leading-relaxed">
              Clears your identity and takes you back to flat setup from step 1.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveTimer({ since }: { since: any }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startMs = since?.toDate ? since.toDate().getTime() : (since?.seconds ?? 0) * 1000;
    if (!startMs) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;

  if (h > 0) return <>{h}h {m}m</>;
  if (m > 0) return <>{m}m {s}s</>;
  return <>{s}s</>;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#F4F4F7] flex items-center justify-center">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full" />
    </div>
  );
}
