import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { authService } from '../services/authService';

export default function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handlePinInput = (num: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + num);
      setError('');
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    const res = await authService.login(pin);
    if (res.success) {
      navigate('/dashboard');
    } else {
      setError(res.message || 'Gagal login');
      setPin('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 max-w-sm w-full">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary-600 text-white p-3 rounded-xl mb-4 shadow-sm">
            <ShoppingCart size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">POS App</h1>
          <p className="text-slate-500 text-sm mt-1">Masukkan PIN untuk masuk</p>
        </div>

        <div className="flex justify-center mb-6">
          <div className="flex gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full transition-colors ${
                  i < pin.length ? 'bg-primary-600' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-danger text-center text-sm mb-4 font-medium">{error}</p>}

        <div className="grid grid-cols-3 gap-3 mb-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handlePinInput(num.toString())}
              className="py-4 text-xl font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleBackspace}
            className="py-4 text-xl font-bold text-slate-500 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
          >
            ⌫
          </button>
          <button
            onClick={() => handlePinInput('0')}
            className="py-4 text-xl font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
          >
            0
          </button>
          <button
            onClick={handleSubmit}
            className="py-4 text-xl font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl transition-colors"
          >
            OK
          </button>
        </div>
        
        <div className="text-center text-xs text-slate-400">
          <p>Owner: 1111 | Admin: 2222</p>
          <p>Supervisor: 3333 | Kasir: 4444</p>
        </div>
      </div>
    </div>
  );
}
