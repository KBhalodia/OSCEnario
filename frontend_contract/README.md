# Frontend contract: levels, rubrics, feedback

Two files, both generated from the backend's real data, so the UI matches the grading exactly.

| File | Use it for | Later served by |
|---|---|---|
| `levels_and_rubrics.json` | Level picker, rubric screens, EPA explanations | `GET /config/grading` |
| `sample_feedback.json` | Building the feedback page before the API exists | `GET /encounters/{id}/feedback` |

Regenerate the first one after any backend change: `python -m scripts.export_frontend_config`.

## levels_and_rubrics.json

- `levels[]`: one per year (M1–M4). Show `label` in the picker; `expectations` as the description;
  `patient_difficulty` as a hint to faculty ("the patient will be guarded and vague").
  - `domains[]`: each rubric category with `mode`: `core`, `lenient`, or `na`. Grey out `na` ones
    ("not expected at this year"). Use `mode_label` as the tooltip.
  - `max_total`: the maximum rubric score at that level (M1 is out of 24 because one category is N/A).
  - `epa_targets[]`: which EPAs are in focus and the target supervision level, e.g.
    "EPA 1, Gather a history: target Direct supervision".
- `rubric`: the full 7-category rubric with `descriptors` for scores 4/3/2/1 (for a "how am I graded?" page).
- `entrustment`: the AAMC EPA list and the 5-level supervision scale (labels for a progress bar).

## sample_feedback.json

`{ "feedback": {...}, "transcript": [...] }`. The page needs these parts:

1. **Header:** `patient_name`, `level_label`, `total`/`max_total`, and a **"Needs faculty review"** banner
   if `needs_review` (with `review_reasons`).
2. **Rubric scores:** `domains[]`: `name`, `score` ("1"–"4" or "N/A"), `mode`, `rationale`, the three
   evidence fields, and `evidence[]` (`turn` + `quote`). **Clicking a quote should scroll to and
   highlight that `turn` in the transcript**; this is what makes the feedback "explainable".
3. **EPAs:** `epas[]`: `estimated_label` vs `target_label`, `meets_target` (true / false / null = not enough
   evidence), `rationale`, `evidence[]`. `epas_not_assessed[]` lists EPAs that couldn't be judged and why.
4. **Findings:** `objectives[]`: each with `found`/`total` and `items[]` (`status` found/missed, `turn`).
   Missed items are the most useful thing to show the student.
5. **Communication stats:** `communication`: open vs closed questions, empathy count,
   `deflections_not_followed_up` (turn numbers), introduced self, closed the encounter.
6. **Strengths / areas for improvement / next-attempt suggestions** (exactly 3) and `summary`.
7. **Faculty view only:** `faculty_notes` (editable text) and `faculty_confirmed_level` on each EPA
   (a dropdown using the entrustment scale).

`transcript[]`: `n` (turn number used in all evidence), `speaker` (student/patient), `text`, `tags`.

Score strings: domain scores are strings ("4", "N/A") because N/A isn't a number.
