export function SnoatLogo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <svg
        viewBox="0 0 80 90"
        aria-hidden="true"
        className="h-7 w-auto text-primary"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polygon
          points="40,5 75,25 75,65 40,85 5,65 5,25"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          d="M 55,30 L 30,30 L 30,45 L 50,45 L 50,60 L 25,60"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-display text-headline-md font-bold tracking-tight text-on-surface">
        snoat
      </span>
      <span className="h-2 w-2 rounded-full bg-primary" />
    </span>
  );
}
