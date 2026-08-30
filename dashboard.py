import json

import pandas as pd
import streamlit as st

st.set_page_config(layout="wide", page_title="ControlPlane Sentinel Telemetry")
st.title("ControlPlane Sentinel Telemetry")


def load_logs():
    try:
        with open("audit_log.jsonl", "r", encoding="utf-8") as f:
            return pd.DataFrame([json.loads(line) for line in f if line.strip()])
    except FileNotFoundError:
        return pd.DataFrame()


df = load_logs()

if not df.empty:
    col1, col2, col3 = st.columns(3)

    success_df = df[df["event"] == "success"]
    col1.metric("Total Requests Processed", len(df))
    col2.metric(
        "Avg Latency Overhead",
        f"{success_df['latency_ms'].mean():.2f} ms" if not success_df.empty else "0 ms",
    )

    baseline_cost = len(success_df) * 150
    actual_cost = success_df["cost_tokens"].sum() if not success_df.empty else 0
    savings = baseline_cost - actual_cost
    col3.metric("Token Cost Savings", f"{savings} tokens")

    st.subheader("Real-Time Audit Trail")
    st.dataframe(df.sort_index(ascending=False), use_container_width=True)
else:
    st.info("No telemetry data found. Run API requests to populate the dashboard.")
