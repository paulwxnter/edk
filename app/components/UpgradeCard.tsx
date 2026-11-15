/**
 * The last card under Discover results on the Atlas and in the Playground: deeper results come with a
 * higher tier, so it points to Billing & Usage. A plain link, since the map also renders outside the router.
 */
export default function UpgradeCard({ href = "/console/billing", className }: { href?: string; className?: string }) {
  return (
    <div className={["upgrade-card", className].filter(Boolean).join(" ")}>
      <span className="upgrade-card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>
      </span>
      <span className="upgrade-card-text">
        <strong>Upgrade</strong>
        <small>Upgrade for more robust results.</small>
      </span>
      <a className="btn btn-primary btn-sm" href={href}>Upgrade</a>
    </div>
  );
}
