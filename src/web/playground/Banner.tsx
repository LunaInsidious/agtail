// A small fixed notice marking the playground: the data is fictional and any
// import lives only in memory (gone on reload), so visitors aren't surprised.
// Non-interactive (pointer-events: none) so it never blocks the UI beneath it;
// the offline cost/plugin limits are documented in the README and the docs.
export function PlaygroundBanner() {
  return (
    <div className="pgbanner">
      <strong>playground</strong> · fictional sample data · imports are in-memory and reset on reload
    </div>
  );
}
