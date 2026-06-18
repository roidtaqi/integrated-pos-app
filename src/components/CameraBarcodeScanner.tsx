import { useEffect, useRef, useState } from 'react';
import { BrowserCodeReader, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, X } from 'lucide-react';

interface CameraBarcodeScannerProps {
  onClose: () => void;
  onDetected: (barcode: string) => Promise<boolean>;
}

function getPreferredCameraId(devices: MediaDeviceInfo[]) {
  const backCamera = devices.find((device) => /back|rear|environment|belakang/i.test(device.label));
  return backCamera?.deviceId || devices[0]?.deviceId || '';
}

export function CameraBarcodeScanner({ onClose, onDetected }: CameraBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const detectedRef = useRef({ text: '', at: 0 });
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [scannerError, setScannerError] = useState('');

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    async function startScanner() {
      try {
        setScannerError('');
        controlsRef.current?.stop();
        controlsRef.current = null;

        let videoInputDevices: MediaDeviceInfo[] = [];
        try {
          videoInputDevices = await BrowserCodeReader.listVideoInputDevices();
        } catch {
          videoInputDevices = [];
        }
        if (cancelled) return;

        setDevices(videoInputDevices);
        const deviceId = selectedDeviceId || getPreferredCameraId(videoInputDevices);
        const handleResult = (result: { getText: () => string } | undefined, scannerControls: IScannerControls) => {
          if (!result) return;

          const text = result.getText().trim();
          const now = Date.now();
          if (!text || (detectedRef.current.text === text && now - detectedRef.current.at < 1500)) return;

          detectedRef.current = { text, at: now };
          void onDetectedRef.current(text).then((success) => {
            if (success) {
              scannerControls.stop();
              onCloseRef.current();
            }
          });
        };

        const controls = deviceId
          ? await reader.decodeFromVideoDevice(deviceId, videoRef.current || undefined, (result, _error, scannerControls) => {
              handleResult(result, scannerControls);
            })
          : await reader.decodeFromConstraints({
              audio: false,
              video: {
                facingMode: { ideal: 'environment' }
              }
            }, videoRef.current || undefined, (result, _error, scannerControls) => {
              handleResult(result, scannerControls);
            });

        if (!videoInputDevices.length) {
          void BrowserCodeReader.listVideoInputDevices()
            .then((nextDevices) => {
              if (!cancelled) setDevices(nextDevices);
            })
            .catch(() => undefined);
        }

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setScannerError('Kamera tidak bisa dibuka. Pastikan izin kamera di browser sudah diizinkan.');
        }
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [selectedDeviceId]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
              <Camera size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Scan Barcode</h3>
              <p className="text-xs text-slate-500">Kamera HP / webcam</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            title="Tutup scanner"
          >
            <X size={20} />
          </button>
        </div>

        <div className="bg-slate-950 p-3">
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-2xl border-2 border-emerald-400/90 shadow-[0_0_0_999px_rgba(2,6,23,0.38)]" />
          </div>
        </div>

        <div className="space-y-3 p-4">
          {devices.length > 1 && (
            <select
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Kamera otomatis</option>
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Kamera ${index + 1}`}
                </option>
              ))}
            </select>
          )}

          {scannerError && (
            <div className="rounded-xl border border-danger/15 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">
              {scannerError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
