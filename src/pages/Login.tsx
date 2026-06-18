import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockKeyhole, LogIn, ShoppingCart, UserRound } from 'lucide-react';
import { authService } from '../services/authService';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const identifierRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    identifierRef.current?.focus();
  }, []);

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!identifier.trim() || !pin.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError('');
    const res = await authService.login(identifier, pin);
    setIsSubmitting(false);

    if (res.success) {
      navigate('/dashboard');
      return;
    }

    setError(res.message || 'Gagal login');
    setPin('');
    pinRef.current?.focus();
  };

  const handleIdentifierKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      pinRef.current?.focus();
    }
  };

  const handleEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    setIdentifier('');
    setPin('');
    setError('');
    identifierRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-7 sm:p-8 rounded-2xl shadow-xl border border-slate-100 max-w-md w-full">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary-600 text-white p-3 rounded-xl mb-4 shadow-sm">
            <ShoppingCart size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Kastur POS</h1>
          <p className="text-slate-500 text-sm mt-1 text-center">Masuk dengan email atau nomor handphone</p>
        </div>

        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label htmlFor="login-identifier" className="block text-sm font-bold text-slate-600 mb-1.5">
              Email / Nomor HP
            </label>
            <div className="relative">
              <UserRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                ref={identifierRef}
                id="login-identifier"
                type="text"
                inputMode="email"
                autoComplete="username"
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setError('');
                }}
                onKeyDown={(event) => {
                  handleIdentifierKeyDown(event);
                  handleEscape(event);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 font-semibold text-slate-800 outline-none transition focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100"
                placeholder="email atau nomor HP"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-pin" className="block text-sm font-bold text-slate-600 mb-1.5">
              PIN
            </label>
            <div className="relative">
              <LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                ref={pinRef}
                id="login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value);
                  setError('');
                }}
                onKeyDown={handleEscape}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-lg font-bold tracking-[0.25em] text-slate-800 outline-none transition focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100"
                placeholder="PIN"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!identifier.trim() || !pin.trim() || isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-4 font-bold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <LogIn size={20} />
            {isSubmitting ? 'Memeriksa...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
