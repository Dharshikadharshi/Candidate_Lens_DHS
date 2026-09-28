import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import CandidateProfilePage from './pages/CandidateProfilePage';
import CandidateInvitationPage from './pages/CandidateInvitationPage';
import { useAuth } from './hooks/useAuth';
import './index.css';

// The video SDK is large; load it only when someone opens an interview room.
const InterviewRoomPage = lazy(() => import('./pages/InterviewRoomPage'));
const InterviewReportPage = lazy(() => import('./pages/InterviewReportPage'));
const ResumeValidationPage = lazy(() => import('./pages/ResumeValidationPage'));

const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>
);

const App: React.FC = () => {
  const { user, loading, login, logout } = useAuth();

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading CandidateLens...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/login" 
          element={!user ? <Login onLogin={login} /> : <Navigate to="/dashboard" replace />} 
        />
        <Route 
          path="/signup" 
          element={!user ? <Signup /> : <Navigate to="/dashboard" replace />} 
        />
        <Route 
          path="/dashboard" 
          element={user ? <Dashboard user={user} onLogout={logout} /> : <Navigate to="/login" replace />} 
        />
        <Route 
          path="/candidates/:candidateId" 
          element={user ? <CandidateProfilePage user={user} onLogout={logout} /> : <Navigate to="/login" replace />} 
        />
        {/* Candidate-facing: authorized by the invitation token, not an HR login */}
        <Route path="/interviews/:interviewId/invitation" element={<CandidateInvitationPage />} />
        <Route path="/interviews/:interviewId/room" element={
            <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading interview room...</div>}>
              <InterviewRoomPage user={user} />
            </Suspense>
          } />
        <Route
          path="/interviews/:interviewId/report"
          element={user ? <Suspense fallback={<PageLoading />}><InterviewReportPage /></Suspense> : <Navigate to="/login" replace />}
        />
        <Route
          path="/candidates/:candidateId/resume-validation"
          element={user ? <Suspense fallback={<PageLoading />}><ResumeValidationPage user={user} onLogout={logout} /></Suspense> : <Navigate to="/login" replace />}
        />
        <Route
          path="/resume-validation/:reportId"
          element={user ? <Suspense fallback={<PageLoading />}><ResumeValidationPage user={user} onLogout={logout} /></Suspense> : <Navigate to="/login" replace />}
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
