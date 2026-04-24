import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Power, 
  Wind, 
  Home, 
  User, 
  Bell, 
  ChevronRight,
  Zap,
  LayoutGrid,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { 
  onSnapshot, 
  collection, 
  doc, 
  updateDoc, 
  serverTimestamp, 
  setDoc,
  getDoc,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { auth, db, signInFrictionless, handleFirestoreError } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { cn } from './lib/utils';

// Types
interface FlatConfig {
  number: string;
  type: '2 BHK' | '3 BHK';
}

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

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [rooms, setRooms] = useState<Record<string, RoomState>>({});
  const [currentTab, setCurrentTab] = useState<'home' | 'settings'>('home');
  const [prevRooms, setPrevRooms] = useState<Record<string, RoomState>>({});
  
  // Onboarding Form State
  const [form, setForm] = useState({
    flatNumber: '',
    flatType: '2 BHK' as '2 BHK' | '3 BHK',
    room: '',
    userName: ''
  });
  
  // Audio Notification
  const playAlert = (roomName: string, status: string) => {
    const audio = new Audio('/mixkit-slot-machine-win-alert-1931.wav');
    audio.play().catch(e => console.log("Audio play blocked by browser", e));

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('AC Sync Update', {
        body: `${roomName} was turned ${status.toUpperCase()}`,
        icon: 'https://cdn-icons-png.flaticon.com/512/2921/2921571.png'
      });
    }
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      console.log('Notification permission:', permission);
    }
  };

  // 1. Auth & Session Persistence
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(true);
        try {
          await signInFrictionless();
        } catch (e: any) {
          console.error("Frictionless sign-in failed", e);
          if (e.code === 'auth/admin-restricted-operation') {
            alert("Error: Anonymous Authentication is disabled. Please enable it in the Firebase Console.");
          }
        }
      } else {
        setUser(u);
        try {
          const profileDoc = await getDoc(doc(db, 'users', u.uid));
          if (profileDoc.exists()) {
            setProfile(profileDoc.data() as UserProfile);
            // Request permission once profile is loaded
            requestNotificationPermission();
          }
        } catch (e) {
          console.error("Profile load failed", e);
        }
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Real-time Synced State for Flat
  useEffect(() => {
    if (!profile || !user) return;

    const roomsRef = collection(db, 'flats', profile.flatId, 'rooms');
    const unsubscribe = onSnapshot(roomsRef, (snapshot) => {
      const state: Record<string, RoomState> = {};
      snapshot.forEach(doc => {
        state[doc.id] = doc.data() as RoomState;
      });

      // Detect Remote Changes for Notifications
      snapshot.docChanges().forEach(change => {
        if (change.type === 'modified') {
          const data = change.doc.data() as RoomState;
          if (data.updatedBy !== user.uid) {
            playAlert(change.doc.id, data.status);
          }
        }
      });

      setRooms(state);
    });

    return () => unsubscribe();
  }, [profile, user]);

  // 3. Actions
  const handleOnboarding = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const flatId = `flat_${form.flatNumber.toLowerCase().replace(/\s+/g, '_')}`;
      const newProfile: UserProfile = {
        name: form.userName,
        flatId,
        room: form.room
      };

      // Save Profile
      await setDoc(doc(db, 'users', user.uid), newProfile);
      
      // Initialize Flat & Rooms if they don't exist
      const flatRef = doc(db, 'flats', flatId);
      const flatDoc = await getDoc(flatRef);
      
      if (!flatDoc.exists()) {
        await setDoc(flatRef, { 
          number: form.flatNumber, 
          type: form.flatType 
        });
        
        // Setup initial rooms
        const roomsToCreate = form.flatType === '2 BHK' 
          ? ['Room A', 'Room B'] 
          : ['Room A', 'Room B', 'Room C'];
        
        const batch = writeBatch(db);
        roomsToCreate.forEach(r => {
          batch.set(doc(db, 'flats', flatId, 'rooms', r), {
            status: 'off',
            updatedBy: 'system',
            updatedByName: 'System',
            updatedAt: serverTimestamp()
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

  const toggleAC = async (roomName: string, currentStatus: 'on' | 'off') => {
    if (!profile || !user) return;
    const newStatus = currentStatus === 'on' ? 'off' : 'on';
    
    try {
      const batch = writeBatch(db);
      
      if (newStatus === 'on') {
        Object.entries(rooms).forEach(([rName, rState]) => {
          if (rName !== roomName && (rState as RoomState).status === 'on') {
            batch.update(doc(db, 'flats', profile.flatId, 'rooms', rName), {
              status: 'off',
              updatedBy: user.uid,
              updatedByName: `${profile.name} (Auto)`,
              updatedAt: serverTimestamp()
            });
          }
        });
      }

      batch.update(doc(db, 'flats', profile.flatId, 'rooms', roomName), {
        status: newStatus,
        updatedBy: user.uid,
        updatedByName: profile.name,
        updatedAt: serverTimestamp()
      });

      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, 'update');
    }
  };

  const handleResetSession = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Delete profile document to trigger onboarding again
      await deleteDoc(doc(db, 'users', user.uid));
      setProfile(null);
      setOnboardingStep(0);
      setCurrentTab('home');
      setForm({
        flatNumber: '',
        flatType: '2 BHK',
        room: '',
        userName: ''
      });
      console.log("Session reset complete");
    } catch (e) {
      console.error("Reset failed", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingScreen />;

  // --- Views ---

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#F4F4F7] p-6 font-sans text-[#1A1A1A]">
        <div className="max-w-md mx-auto h-full flex flex-col pt-12">
          <header className="mb-12">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100 mb-6">
              <Wind className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-neutral-900">AC Sync</h1>
            <p className="text-neutral-500 font-medium mt-1">Lightweight flatmate AC control.</p>
          </header>

          <AnimatePresence mode="wait">
            {onboardingStep === 0 && (
              <motion.div 
                key="step0"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-neutral-200">
                  <label className="text-xs font-bold uppercase tracking-widest text-neutral-400 block mb-4">Flat Setup</label>
                  <div className="space-y-4">
                    <input 
                      placeholder="Flat Number (e.g. 402)"
                      className="w-full bg-neutral-50 border border-neutral-200 p-4 rounded-2xl outline-none focus:border-indigo-500 transition-colors"
                      value={form.flatNumber}
                      onChange={e => setForm({...form, flatNumber: e.target.value})}
                    />
                    <div className="flex gap-2">
                      {['2 BHK', '3 BHK'].map(t => (
                        <button
                          key={t}
                          onClick={() => setForm({...form, flatType: t as any})}
                          className={cn(
                            "flex-1 p-4 rounded-2xl border font-bold transition-all",
                            form.flatType === t ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100" : "bg-white border-neutral-200 text-neutral-500"
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button 
                  disabled={!form.flatNumber}
                  onClick={() => setOnboardingStep(1)}
                  className="w-full bg-neutral-900 text-white py-5 rounded-[2rem] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                >
                  Next Step <ChevronRight className="w-5 h-5" />
                </button>
              </motion.div>
            )}

            {onboardingStep === 1 && (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-neutral-200">
                  <label className="text-xs font-bold uppercase tracking-widest text-neutral-400 block mb-4">Your Identity</label>
                  <div className="space-y-4">
                    <input 
                      placeholder="Your Name"
                      className="w-full bg-neutral-50 border border-neutral-200 p-4 rounded-2xl outline-none focus:border-indigo-500 transition-colors"
                      value={form.userName}
                      onChange={e => setForm({...form, userName: e.target.value})}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      {(form.flatType === '2 BHK' ? ['Room A', 'Room B'] : ['Room A', 'Room B', 'Room C']).map(r => (
                        <button
                          key={r}
                          onClick={() => setForm({...form, room: r})}
                          className={cn(
                            "p-4 rounded-2xl border font-bold transition-all",
                            form.room === r ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100" : "bg-white border-neutral-200 text-neutral-500"
                          )}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button 
                  disabled={!form.userName || !form.room}
                  onClick={handleOnboarding}
                  className="w-full bg-indigo-600 text-white py-5 rounded-[2rem] font-bold shadow-xl shadow-indigo-100 active:scale-95 transition-all disabled:opacity-50"
                >
                  Start Syncing
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // Dashboard View
  const activeRooms = Object.values(rooms).filter(r => (r as RoomState).status === 'on').length;

  return (
    <div className="min-h-screen bg-[#F4F4F7] font-sans text-[#1A1A1A]">
      <div className="max-w-md mx-auto p-5 pb-10 h-full flex flex-col gap-4">
        
        {currentTab === 'home' ? (
          <>
            {/* Header Bento */}
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
              <button 
                onClick={() => setCurrentTab('settings')}
                className="flex -space-x-2 cursor-pointer transition-transform active:scale-90"
              >
                <div className="w-9 h-9 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center text-sm font-bold text-indigo-600 uppercase shadow-sm">
                  {profile.name[0]}
                </div>
              </button>
            </div>

            {/* Global Summary Bento */}
            <div className={cn(
              "rounded-[2rem] p-6 shadow-sm flex flex-col justify-center transition-all duration-700",
              activeRooms > 1 ? "bg-orange-50 border border-orange-100" : "bg-indigo-600 border border-indigo-600 shadow-xl shadow-indigo-100"
            )}>
              <div className="flex items-center justify-between mb-2">
                <div className={cn("p-2 rounded-lg", activeRooms > 1 ? "bg-orange-100 text-orange-600" : "bg-indigo-500 text-white")}>
                  {activeRooms > 1 ? <AlertTriangle className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                </div>
                <span className={cn("text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg", activeRooms > 1 ? "bg-orange-100 text-orange-600" : "bg-indigo-500 text-indigo-100")}>
                  {activeRooms > 1 ? 'High Load' : 'Optimal'}
                </span>
              </div>
              <p className={cn("text-4xl font-black tracking-tighter", activeRooms > 1 ? "text-orange-900" : "text-white")}>
                {activeRooms} <span className="text-xl font-bold opacity-60">Active ACs</span>
              </p>
              {activeRooms > 1 && (
                <p className="text-xs text-orange-700 font-bold mt-2">Exceeding suggested limit. Coordination needed!</p>
              )}
            </div>

            {/* Room Grid */}
            <div className="grid grid-cols-2 gap-4">
              {(Object.entries(rooms) as [string, RoomState][]).map(([name, state]) => (
                <div 
                  key={name}
                  className={cn(
                    "rounded-[2.5rem] p-6 flex flex-col justify-between transition-all duration-500 border h-52",
                    state.status === 'on' 
                      ? "bg-white border-indigo-200 shadow-xl shadow-indigo-100" 
                      : "bg-white border-neutral-200 shadow-sm opacity-60"
                  )}
                >
                  <div className="flex flex-col">
                    <div className="flex justify-between items-start">
                      <span className={cn(
                        "text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded",
                        state.status === 'on' ? "bg-indigo-100 text-indigo-600" : "bg-neutral-100 text-neutral-400"
                      )}>
                        {name === profile.room ? 'MY ROOM' : 'FLATMATE'}
                      </span>
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        state.status === 'on' ? "bg-green-500 animate-pulse ring-4 ring-green-500/20" : "bg-neutral-300"
                      )} />
                    </div>
                    <h4 className="text-xl font-black mt-3 leading-tight text-neutral-900">{name}</h4>
                    <p className="text-[10px] text-neutral-400 font-bold mt-1 uppercase">
                      {state.status === 'on' ? `By ${state.updatedByName}` : 'Standby'}
                    </p>
                  </div>

                  <button 
                    onClick={() => toggleAC(name, state.status)}
                    className={cn(
                      "w-full py-4 rounded-2xl font-black text-[10px] tracking-widest transition-all active:scale-95 shadow-sm cursor-pointer",
                      state.status === 'on' ? "bg-indigo-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                    )}
                  >
                    {state.status === 'on' ? 'SHUT OFF' : 'TURN ON'}
                  </button>
                </div>
              ))}
            </div>

            {/* Activity Log Bento */}
            <div className="bg-[#1A1A1A] rounded-[2.5rem] p-8 text-white mt-2 mb-4">
               <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black tracking-tight">Activity Log</h3>
                <Bell className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="space-y-6">
                {(Object.entries(rooms) as [string, RoomState][]).filter(([_, s]) => s.updatedByName !== 'System').map(([name, s]) => (
                  <div key={name} className="border-l-2 border-indigo-500 pl-4 py-1">
                    <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Recent Action</p>
                    <p className="text-sm font-medium leading-snug mt-1">
                      <span className="text-white font-black">{s.updatedByName}</span> switched <span className="text-indigo-400 font-bold">{name}</span> to {s.status.toUpperCase()}
                    </p>
                  </div>
                ))}
                {(Object.values(rooms) as RoomState[]).every(r => r.updatedByName === 'System') && (
                  <p className="text-sm text-neutral-500 italic text-center py-4">No recent activity detected.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-6 pt-4">
            <div className="flex items-center gap-4 mb-4">
              <button 
                onClick={() => setCurrentTab('home')}
                className="w-10 h-10 bg-white border border-neutral-200 rounded-xl flex items-center justify-center text-neutral-400 hover:text-indigo-600 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-5 h-5 rotate-180" />
              </button>
              <h1 className="text-2xl font-black tracking-tight text-neutral-900">Settings</h1>
            </div>

            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-neutral-200">
              <h3 className="text-xl font-black tracking-tight mb-6">User Profile</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-4 bg-neutral-50 rounded-2xl">
                  <span className="text-sm font-bold text-neutral-500">Name</span>
                  <span className="font-bold">{profile.name}</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-neutral-50 rounded-2xl">
                  <span className="text-sm font-bold text-neutral-500">Flat</span>
                  <span className="font-bold">{profile.flatId.split('_').slice(1).join(' ').toUpperCase()}</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-neutral-50 rounded-2xl">
                  <span className="text-sm font-bold text-neutral-500">Assigned Room</span>
                  <span className="font-bold">{profile.room}</span>
                </div>
              </div>
            </div>

            <button
               onClick={handleResetSession}
               className="w-full bg-orange-50 text-orange-600 p-5 rounded-[2rem] font-black flex items-center justify-center gap-3 transition-all active:scale-95 border border-orange-100 cursor-pointer"
            >
              Reset Session
            </button>

            <p className="text-center text-xs text-neutral-400 font-medium px-8 leading-relaxed">
              Resetting will clear your local identity and require you to set up your flat mapping again.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#F4F4F7] flex items-center justify-center">
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full"
      />
    </div>
  );
}
