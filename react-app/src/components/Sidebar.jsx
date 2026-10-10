import React from "react";

export default function Sidebar({ patients, currentId, onSelect, onNew }) {
  return (
    <aside aria-label="Patient library">
      <h2>Your patients</h2>
      <ul className="plist">
        {patients.map((p) => (
          <li key={p.id}>
            <button
              className="pbtn"
              type="button"
              aria-current={String(p.id === currentId)}
              onClick={() => onSelect(p.id)}
            >
              <b>{p.title || "Untitled case"}</b>
              <small>
                {(p.name || "No name yet") +
                  " \u00b7 " +
                  (p.status === "published" ? "Published" : "Draft")}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn block" type="button" onClick={onNew}>
        New patient
      </button>
    </aside>
  );
}
