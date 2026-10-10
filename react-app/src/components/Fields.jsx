import React from "react";
import { splitWords } from "../studio.js";

export function Field({ label, children }) {
  return (
    <label className="f">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function TextInput({ value, type = "text", onChange }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextArea({ value, rows = 2, onChange }) {
  return (
    <textarea
      rows={rows}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function WordsInput({ value, onChange }) {
  return (
    <input
      type="text"
      value={(value || []).join(", ")}
      onChange={(e) => onChange(splitWords(e.target.value))}
    />
  );
}

export function SelectInput({ value, options, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function Checkbox({ checked, label, onChange }) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
