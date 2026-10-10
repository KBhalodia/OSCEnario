import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "twinverse.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS patients (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS encounters (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            )
        """)


def save_record(table, record_id, data):
    if table not in ("patients", "encounters"):
        raise ValueError("Invalid table")

    with get_connection() as conn:
        conn.execute(
            f"INSERT OR REPLACE INTO {table} (id, data) VALUES (?, ?)",
            (record_id, json.dumps(data)),
        )


def get_record(table, record_id):
    if table not in ("patients", "encounters"):
        raise ValueError("Invalid table")

    with get_connection() as conn:
        row = conn.execute(
            f"SELECT data FROM {table} WHERE id = ?",
            (record_id,),
        ).fetchone()

    return json.loads(row["data"]) if row else None


def list_records(table):
    if table not in ("patients", "encounters"):
        raise ValueError("Invalid table")

    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT data FROM {table}"
        ).fetchall()

    return [json.loads(row["data"]) for row in rows]