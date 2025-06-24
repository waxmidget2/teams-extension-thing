import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Plus, Trash2, RotateCcw } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

// --- Configuration ---
const JOB_ROLES = {
  'Executive (C-Suite)': { rate: 250 },
  'Director / VP': { rate: 175 },
  'Senior Manager': { rate: 140 },
  'Project Manager': { rate: 110 },
  'Senior Software Engineer': { rate: 125 },
  'Software Engineer': { rate: 90 },
  'UX/UI Designer': { rate: 85 },
  'Quality Assurance Analyst': { rate: 75 },
  'Marketing Specialist': { rate: 70 },
  'Intern / Junior Staff': { rate: 35 },
};

// --- Helper Functions ---
const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
const formatTime = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [hours, minutes, seconds].map(v => v.toString().padStart(2, '0')).join(':');
};

// --- Animated Counter Component ---
const AnimatedCounter = ({ value, formatter }) => {
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => { setDisplayValue(value); }, [value]);
  return <span className="transition-colors duration-300">{formatter(displayValue)}</span>;
};

// --- Main App Component ---
export default function App() {
  const [meetingDocRef, setMeetingDocRef] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState(Object.keys(JOB_ROLES)[0]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [error, setError] = useState(null);

  const intervalRef = useRef(null);

  // --- Initialization Effect (Teams SDK & Firebase) ---
  useEffect(() => {
    const initialize = async () => {
      try {
        // The microsoftTeams object is globally available from the SDK script in index.html
        await window.microsoftTeams.app.initialize();
        const context = await window.microsoftTeams.app.getContext();
        const meetingId = context.meeting.id;

        if (!meetingId) {
          setError("This app can only be run in a Teams meeting.");
          setIsLoading(false);
          return;
        }

        // Pull config from Vercel environment variables
        const appId = process.env.REACT_APP_APP_ID || 'default-app-id';
        const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG) : null;

        if (!firebaseConfig) {
          setError("Firebase configuration is missing.");
          setIsLoading(false);
          return;
        }

        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);

        // No authentication needed. Directly set the document reference.
        const docRef = doc(firestore, 'artifacts', appId, 'public/data/meetings', meetingId);
        setMeetingDocRef(docRef);

      } catch (e) {
        console.error(e);
        // Fallback for development outside of Teams
        console.warn("Running in fallback mode. Using a test meeting ID.");
        const appId = process.env.REACT_APP_APP_ID || 'default-app-id';
        const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG) : null;
        if (firebaseConfig) {
          const app = initializeApp(firebaseConfig);
          const firestore = getFirestore(app);
          const testMeetingId = "test-meeting-no-auth";
          const docRef = doc(firestore, 'artifacts', appId, 'public/data/meetings', testMeetingId);
          setMeetingDocRef(docRef);
        } else {
          setError("Failed to initialize. Firebase config missing.");
          setIsLoading(false);
        }
      }
    };
    initialize();
  }, []);

  // --- Real-time Data Sync from Firestore ---
  useEffect(() => {
    if (!meetingDocRef) return;

    const unsubscribe = onSnapshot(meetingDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setParticipants(data.participants || []);
        setIsRunning(data.isRunning || false);
        setAccumulatedSeconds(data.accumulatedSeconds || 0);
        setStartTime(data.startTime || null);
      } else {
        setDoc(meetingDocRef, { participants: [], isRunning: false, accumulatedSeconds: 0, startTime: null });
      }
      setIsLoading(false);
    }, (err) => {
      console.error(err);
      setError("Failed to connect to the database. Check your Firestore security rules.");
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [meetingDocRef]);

  // --- Timer and Cost Calculation Logic ---
  const calculateCosts = useCallback(() => {
    let currentElapsed = accumulatedSeconds;
    if (isRunning && startTime) {
      currentElapsed += (Timestamp.now().seconds - startTime.seconds);
    }
    setElapsedSeconds(currentElapsed);
    const totalRatePerSecond = participants.reduce((acc, p) => acc + (p.rate / 3600), 0);
    setTotalCost(totalRatePerSecond * currentElapsed);
  }, [participants, isRunning, startTime, accumulatedSeconds]);

  useEffect(() => {
    clearInterval(intervalRef.current);
    calculateCosts();
    if (isRunning) {
      intervalRef.current = setInterval(calculateCosts, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, participants, startTime, accumulatedSeconds, calculateCosts]);

  // --- Firestore Write Handlers ---
  const handleAddParticipant = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newRole || !meetingDocRef) return;
    const newParticipant = { id: Date.now(), name: newName.trim(), role: newRole, rate: JOB_ROLES[newRole].rate };
    await setDoc(meetingDocRef, { participants: [...participants, newParticipant] }, { merge: true });
    setNewName('');
  };
  const handleRemoveParticipant = async (id) => await setDoc(meetingDocRef, { participants: participants.filter(p => p.id !== id) }, { merge: true });
  const handleReset = async () => await setDoc(meetingDocRef, { participants: [], isRunning: false, accumulatedSeconds: 0, startTime: null });
  const handleToggleTimer = async () => {
    if (participants.length === 0) return;
    if (isRunning) {
      const elapsedSinceStart = startTime ? Timestamp.now().seconds - startTime.seconds : 0;
      await setDoc(meetingDocRef, { isRunning: false, accumulatedSeconds: accumulatedSeconds + elapsedSinceStart, startTime: null }, { merge: true });
    } else {
      await setDoc(meetingDocRef, { isRunning: true, startTime: serverTimestamp() }, { merge: true });
    }
  };
  const getParticipantCost = (rate) => (rate / 3600) * elapsedSeconds;

  // --- Render Logic ---
  if (isLoading) return <div className="bg-[#201F1F] text-white h-screen flex items-center justify-center p-4 text-center"><p>Initializing Meeting Calculator...</p></div>;
  if (error) return <div className="bg-[#201F1F] text-red-400 h-screen flex items-center justify-center p-4 text-center"><p>Error: {error}</p></div>;

  return (
    <div className="bg-[#201F1F] text-white h-screen font-sans flex flex-col p-4 space-y-4 overflow-hidden">
      <div className="w-full bg-gradient-to-br from-green-500/20 to-blue-500/20 p-4 rounded-xl shadow-lg border border-white/10 text-center">
        <p className="text-sm text-gray-300 uppercase tracking-wider">Total Meeting Cost</p>
        <p className="text-4xl font-bold text-green-300 tracking-tight"><AnimatedCounter value={totalCost} formatter={formatCurrency} /></p>
        <p className="text-2xl font-mono text-blue-300 mt-2"><AnimatedCounter value={elapsedSeconds} formatter={formatTime} /></p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <button onClick={handleToggleTimer} disabled={participants.length === 0} className={`flex items-center justify-center p-2.5 rounded-lg text-white font-semibold transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 ${isRunning ? 'bg-yellow-500 hover:bg-yellow-600 focus:ring-yellow-400' : 'bg-green-500 hover:bg-green-600 focus:ring-green-400'} disabled:bg-gray-600 disabled:opacity-50`}>
          {isRunning ? <Pause size={18}/> : <Play size={18}/>}
        </button>
        <button onClick={() => setIsFormVisible(!isFormVisible)} className="flex items-center justify-center p-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-800"><Plus size={18}/></button>
        <button onClick={handleReset} className="flex items-center justify-center p-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-offset-gray-800"><RotateCcw size={18}/></button>
      </div>
      <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isFormVisible ? 'max-h-60' : 'max-h-0'}`}>
        <form onSubmit={handleAddParticipant} className="bg-white/5 rounded-lg p-4 mt-2 space-y-3">
          <input type="text" placeholder="Participant Name" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full bg-gray-700 border-gray-600 text-white rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"/>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full bg-gray-700 border-gray-600 text-white rounded-md p-2 focus:ring-blue-500 focus:border-blue-500">
            {Object.keys(JOB_ROLES).map(role => (<option key={role} value={role}>{role}</option>))}
          </select>
          <button type="submit" className="w-full p-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors">Add</button>
        </form>
      </div>
      <div className="flex-grow overflow-y-auto pr-2 -mr-2">
        <h2 className="text-lg font-semibold mb-2 text-gray-300">Participants ({participants.length})</h2>
        {participants.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-gray-500">Add participants to begin</div>
        ) : (
          <ul className="space-y-2">
            {participants.map((p) => (
              <li key={p.id} className="bg-white/5 p-3 rounded-lg flex items-center justify-between shadow transition-all duration-300 ease-in-out motion-safe:animate-fade-in">
                <div>
                  <p className="font-semibold text-gray-200">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.role}</p>
                </div>
                <div className="text-right flex items-center space-x-3">
                  <p className="font-semibold text-green-400">{formatCurrency(getParticipantCost(p.rate))}</p>
                  <button onClick={() => handleRemoveParticipant(p.id)} className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-500/20 rounded-full transition-colors"><Trash2 size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}