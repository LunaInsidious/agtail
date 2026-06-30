// A small fixed notice marking the playground: the data is fictional and any
// import lives only in memory (gone on reload), so visitors aren't surprised.
// The tooltip spells out the one thing that's intentionally limited here vs. the
// installed tool: pricing and plugin attribution only cover the bundled sample.
const LIMITS =
  "You can import your own exported bundle — it's fully searchable and viewable, and stays in your browser. " +
  "Only cost (priced for the sample's models) and 🧩 plugin attribution (the sample's plugins) are limited here; " +
  "run the installed agtail for full LiteLLM pricing and your own plugins.";

export function PlaygroundBanner() {
  return (
    <div className="pgbanner" title={LIMITS}>
      <strong>playground</strong> · fictional sample data · imports are in-memory and reset on reload
    </div>
  );
}
