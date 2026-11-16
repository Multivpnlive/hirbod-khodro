export function PrismBackdrop() {
  return (
    <div className="prism-backdrop" aria-hidden="true">
      <span className="prism-backdrop__grid" />
      <span className="prism-backdrop__glow prism-backdrop__glow--purple" />
      <span className="prism-backdrop__glow prism-backdrop__glow--pink" />
      <span className="prism-backdrop__glow prism-backdrop__glow--cyan" />
      <span className="prism-backdrop__orbit prism-backdrop__orbit--one">
        <span className="prism-backdrop__node" />
      </span>
      <span className="prism-backdrop__orbit prism-backdrop__orbit--two">
        <span className="prism-backdrop__node" />
      </span>
      <span className="prism-backdrop__orbit prism-backdrop__orbit--three" />
      <span className="prism-backdrop__particle prism-backdrop__particle--one" />
      <span className="prism-backdrop__particle prism-backdrop__particle--two" />
      <span className="prism-backdrop__particle prism-backdrop__particle--three" />
      <span className="prism-backdrop__particle prism-backdrop__particle--four" />
      <span className="prism-backdrop__particle prism-backdrop__particle--five" />
    </div>
  );
}
