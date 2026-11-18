/** ClearDesk wordmark shared by the session and workspace views. */

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>
        cleardesk<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
