/** ~/jdev-ai▌ — el cursor solo parpadea si la personalidad lo permite (lo decide el CSS). */
export function Logo() {
  return (
    <span className="logo">
      <span className="logo__tilde">~/</span>jdev-ai
      <span className="logo__cursor" aria-hidden="true">
        ▌
      </span>
    </span>
  );
}
