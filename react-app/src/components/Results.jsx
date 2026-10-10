import React from "react";

export default function Results({ result }) {
  if (!result) return <div className="results" />;
  const { errors, warnings, published } = result;
  const bad = errors.length > 0;
  return (
    <div className="results">
      <div className={"res " + (bad ? "bad" : "good")} role="status">
        {bad ? (
          <>
            <h3>Cannot publish yet</h3>
            <p>
              <span className="must">Must fix:</span>
            </p>
            <ul>
              {errors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </>
        ) : (
          <h3>
            {published
              ? "Published. Students can now run this patient."
              : "No blocking problems found."}
          </h3>
        )}

        {warnings.length > 0 ? (
          <>
            <p>
              <span className="warn">Worth a look:</span>
            </p>
            <ul>
              {warnings.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </>
        ) : (
          !bad && <p>Everything is consistent.</p>
        )}
      </div>
    </div>
  );
}
