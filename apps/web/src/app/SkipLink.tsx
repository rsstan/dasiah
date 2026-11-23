// First stop of the keyboard on every page: jumps past the brand and the menu to the content.
// The target gets the focus directly (no "#content" in the address, which the router would see).
export function SkipLink({ target }: { target: string }) {
  return (
    <a
      className="skip-link"
      href={`#${target}`}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(target)?.focus();
      }}
    >
      Skip to content
    </a>
  );
}
