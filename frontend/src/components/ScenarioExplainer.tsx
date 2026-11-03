/**
 * The one scenario, in plain words: ATC says one altitude, the pilot
 * mishears another. Always visible so a judge gets the setup in seconds.
 */
export function ScenarioExplainer(): React.JSX.Element {
  return (
    <section className="panel scenario-explainer" aria-label="Scenario">
      <h2>The scenario: one misunderstood number</h2>
      <ol>
        <li>ATC clears META 452 to maintain 23,000 ft.</li>
        <li>
          The pilot mishears 22,000 ft and sets that instead — right where other
          traffic is flying.
        </li>
        <li>
          ClearanceGuard catches it while the aircraft is still level, and walks
          ATC, then the pilot, to one verified number.
        </li>
      </ol>
    </section>
  );
}
