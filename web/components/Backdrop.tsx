/** Soft colour glow behind every page. Plain CSS: React Bits' Aurora rendered as a grey wash in WebKit and Chrome. */
export function Backdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[70vh] [background:radial-gradient(60%_50%_at_15%_0%,rgba(163,230,53,0.18),transparent_70%),radial-gradient(50%_45%_at_85%_10%,rgba(34,211,238,0.16),transparent_70%),radial-gradient(45%_40%_at_50%_35%,rgba(167,139,250,0.12),transparent_70%)]"
    />
  );
}
