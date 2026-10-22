type SessionActivityIconProps = {
  running: boolean;
  label: string;
};

export default function SessionActivityIcon({
  running,
  label,
}: SessionActivityIconProps) {
  return (
    <span
      className={`session-activity-icon ${running ? "running" : "idle"}`}
      role="img"
      aria-label={label}
    >
      {running ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle className="session-activity-track" cx="12" cy="12" r="8" />
          <circle className="session-activity-orbit" cx="12" cy="12" r="8" />
          <circle className="session-activity-core" cx="12" cy="12" r="2.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            className="session-activity-bubble"
            d="M6.5 6.75h11a2 2 0 0 1 2 2v5.75a2 2 0 0 1-2 2h-6.2L7 19.25V16.5h-.5a2 2 0 0 1-2-2V8.75a2 2 0 0 1 2-2Z"
          />
          <path className="session-activity-rest" d="M8.25 11.6h7.5" />
        </svg>
      )}
    </span>
  );
}
