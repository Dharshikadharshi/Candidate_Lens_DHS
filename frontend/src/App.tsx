import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import { useAuth } from './hooks/useAuth';
import './index.css';

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
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
