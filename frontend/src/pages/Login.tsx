import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { LogIn, UserPlus } from 'lucide-react';

interface LoginProps {
  onLogin: (token: string, user: any) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  
  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);

      const res = await api.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      
      const token = res.data.access_token;
      
      // Get user info
      const userRes = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      onLogin(token, userRes.data);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/signup', {
        name,
        email,
        password,
        confirm_password: confirmPassword
      });
      
      setSuccess('Account created successfully! Please sign in.');
      setIsLogin(true);
      // clear fields
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            {isLogin ? (
              <LogIn size={48} color="var(--primary-color)" />
            ) : (
              <UserPlus size={48} color="var(--primary-color)" />
            )}
          </div>
          <h1 className="login-title">CandidateLens</h1>
          <p className="login-subtitle">
            {isLogin ? 'See beyond the resume. Hire for readiness.' : 'Create an account to get started.'}
          </p>
        </div>
        
        {error && <div className="error-message">{error}</div>}
        {success && <div style={{ color: 'var(--success-color)', fontSize: '0.875rem', marginBottom: '1rem', textAlign: 'center' }}>{success}</div>}
        
        <form onSubmit={isLogin ? handleLogin : handleSignUp}>
          {!isLogin && (
            <div className="form-group">
              <label className="form-label" htmlFor="name">Full Name (Username)</label>
              <input
                id="name"
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="John Doe"
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="admin@candidatelens.com"
            />
          </div>
          
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          {!isLogin && (
            <div className="form-group">
              <label className="form-label" htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </div>
          )}
          
          <button 
            type="submit" 
            className="btn-primary"
            disabled={loading}
          >
            {loading ? (isLogin ? 'Signing in...' : 'Signing up...') : (isLogin ? 'Sign In' : 'Sign Up')}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem' }}>
          {isLogin ? (
            <p>
              Don't have an account?{' '}
              <span className="action-link" onClick={() => { setIsLogin(false); setError(''); setSuccess(''); }}>
                Sign up
              </span>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <span className="action-link" onClick={() => { setIsLogin(true); setError(''); setSuccess(''); }}>
                Sign in
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
