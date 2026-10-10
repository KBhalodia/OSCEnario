"""
SQLite store: every record is one JSON document keyed by id (same design as the
original backend-api branch, plus tables for assignments and feedback).
"""
import json
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("VPE_DB_PATH", Path(__file__).resolve().parent.parent / "twinverse.db"))
TABLES = ("patients", "encounters", "assignments", "feedback")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
        for table in TABLES:
            conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                )
            """)


def _check(table):
    if table not in TABLES:
        raise ValueError("Invalid table")


def save_record(table, record_id, data):
    _check(table)
    with get_connection() as conn:
        conn.execute(
            f"INSERT OR REPLACE INTO {table} (id, data) VALUES (?, ?)",
            (record_id, json.dumps(data, default=str)),
        )


def get_record(table, record_id):
    _check(table)
    with get_connection() as conn:
        row = conn.execute(f"SELECT data FROM {table} WHERE id = ?", (record_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def list_records(table):
    _check(table)
    with get_connection() as conn:
        rows = conn.execute(f"SELECT data FROM {table}").fetchall()
    return [json.loads(row["data"]) for row in rows]


def delete_record(table, record_id):
    _check(table)
    with get_connection() as conn:
        conn.execute(f"DELETE FROM {table} WHERE id = ?", (record_id,))
