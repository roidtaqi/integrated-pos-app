export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-6 h-full flex flex-col items-center justify-center text-slate-500">
      <div className="text-4xl mb-4">🚧</div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">{title}</h2>
      <p>Halaman ini sedang dalam pengembangan.</p>
    </div>
  );
}
